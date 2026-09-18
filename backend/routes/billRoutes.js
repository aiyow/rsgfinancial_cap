import express from "express";
import { z } from "zod";
import pool from "../config/db.js";
import { allowRoles, requireAuth } from "../middleware/authMiddleware.js";
import { requireId, validateBody } from "../middleware/validate.js";
import { applyDueLatePenalties, applyUnitCreditToOpenBills, billAppliedSql, billLatePenaltySql, billTotalSql, ensurePaymentLedgerSchema } from "../services/paymentLedger.js";
import { defaultSoaTemplate, ensureSoaTemplate, normalizeSoaTemplate } from "../services/soaTemplate.js";
import { writeAuditLog } from "../services/auditLog.js";
import { createUserNotifications } from "../services/notifications.js";
import { deliverSoaEmailNotifications } from "../services/soaEmailDeliveries.js";
import { validateMeterReading } from "../services/meterReadingValidation.js";
import { ensureBillingErrorSchema } from "../services/billingErrors.js";

const router = express.Router();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format.");
const chargeEditSchema = z.object({
  id: z.coerce.number().int().positive(),
  description: z.string().trim().min(1).max(255).optional(),
  quantity: z.coerce.number().min(0).optional(),
  rateApplied: z.coerce.number().min(0).optional(),
}).strict().refine((body) => Object.keys(body).length > 1, { message: "Change at least one charge field." });
const editBillSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  payerName: z.union([z.string().trim().max(150), z.null()]).optional(),
  payerEmail: z.union([z.string().trim().max(255), z.null()]).optional(),
  periodStart: dateSchema.optional(),
  periodEnd: dateSchema.optional(),
  statementDate: dateSchema.optional(),
  dueDate: dateSchema.optional(),
  previousReading: z.coerce.number().min(0).optional(),
  currentReading: z.coerce.number().min(0).optional(),
  charges: z.array(chargeEditSchema).min(1).optional(),
  billingErrorReportId: z.coerce.number().int().positive().optional(),
}).strict().refine((body) => Object.keys(body).some((key) => key !== "reason" && key !== "billingErrorReportId"), {
  message: "Change at least one SOA field.",
});
const paymentReferenceSchema = z.object({
  officialReceiptNumber: z.union([z.string().trim().min(1).max(100), z.null()]).optional(),
  invoiceNumber: z.union([z.string().trim().min(1).max(100), z.null()]).optional(),
  paymentNote: z.union([z.string().trim().min(1).max(1000), z.null()]).optional(),
}).strict().refine((body) => Object.keys(body).length > 0, { message: "Update at least one payment reference field." });

const approvedPaymentSql = billAppliedSql;
const unitAdvanceSql = `COALESCE((SELECT ROUND(SUM(pay.verified_amount - COALESCE((
  SELECT SUM(app.amount_applied) FROM payment_applications app WHERE app.payment_submission_id = pay.id
), 0)), 2) FROM payment_submissions pay WHERE pay.unit_id = b.unit_id AND pay.review_status = 'APPROVED'), 0)`;
const billSelect = `SELECT b.id, b.unit_id AS "unitId", b.billing_period_id AS "billingPeriodId",
  b.unit_number_snapshot AS "unitNumber", b.period_start_snapshot AS "periodStart",
  b.period_end_snapshot AS "periodEnd", b.statement_date AS "statementDate",
  b.due_date_snapshot AS "dueDate", p.status,
  b.soa_generated_at AS "soaGeneratedAt",
  b.previous_reading_snapshot AS "previousReading",
  b.current_reading_snapshot AS "currentReading",
  b.current_reading_snapshot - b.previous_reading_snapshot AS consumption,
  b.payer_name_snapshot AS "payerName", b.payer_email_snapshot AS "payerEmail",
  b.generation_warning AS "generationWarning",
  b.official_receipt_number AS "officialReceiptNumber", b.invoice_number AS "invoiceNumber",
  b.payment_note AS "paymentNote", b.soa_revision AS "soaRevision",
  b.corrected_at AS "correctedAt", b.corrected_by AS "correctedBy", b.correction_reason AS "correctionReason",
  b.late_penalty_percent_snapshot AS "latePenaltyPercent",
  b.published_at AS "publishedAt", b.published_by AS "publishedBy",
  (SELECT jsonb_build_object(
    'sent', COUNT(*) FILTER (WHERE delivery.status = 'SENT')::int,
    'failed', COUNT(*) FILTER (WHERE delivery.status = 'FAILED')::int,
    'pending', COUNT(*) FILTER (WHERE delivery.status = 'PENDING')::int
   ) FROM soa_email_deliveries delivery WHERE delivery.unit_bill_id = b.id) AS "emailDelivery",
  COALESCE(b.soa_template_snapshot, (SELECT template_data FROM soa_templates WHERE id = 1)) AS "soaTemplate",
  ${billLatePenaltySql} AS "latePenaltyAmount", ${billTotalSql} AS "totalAmount", ${approvedPaymentSql} AS "approvedAmount",
  ${unitAdvanceSql} AS "advanceBalance",
  GREATEST(${billTotalSql} - ${approvedPaymentSql}, 0) AS "remainingBalance",
  EXISTS (
    SELECT 1
    FROM payment_submissions pending
    WHERE pending.target_unit_bill_id = b.id AND pending.review_status = 'PENDING'
  ) AS "hasPendingPayment",
  CASE WHEN ${approvedPaymentSql} >= ${billTotalSql} AND ${billTotalSql} > 0 THEN 'PAID'
    WHEN ${approvedPaymentSql} > 0 THEN 'PARTIAL'
    WHEN b.due_date_snapshot < CURRENT_DATE THEN 'OVERDUE' ELSE 'UNPAID' END AS "paymentStatus"
  FROM unit_bills b
  JOIN billing_periods p ON p.id = b.billing_period_id
  LEFT JOIN bill_charges c ON c.unit_bill_id = b.id`;
const groupBy = "GROUP BY b.id, p.status, b.soa_template_snapshot";

async function readBill(client, id) {
  await applyDueLatePenalties(client, id);
  const bill = await client.query(`${billSelect} WHERE b.id = $1 ${groupBy}`, [id]);
  if (!bill.rows[0]) return null;
  const charges = await client.query(
    `SELECT id, charge_type AS "chargeType", quantity, rate_applied AS "rateApplied",
      ROUND(quantity * rate_applied, 2) AS amount, description
     FROM bill_charges WHERE unit_bill_id = $1 ORDER BY id`, [id],
  );
  return { ...bill.rows[0], charges: charges.rows };
}

function dateOnly(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

router.use(requireAuth, allowRoles("ADMIN", "COLLECTOR", "RESIDENT"));

router.get("/", async (req, res, next) => {
  try {
    await ensureSoaTemplate(pool);
    await ensurePaymentLedgerSchema(pool);
    await ensureBillingErrorSchema(pool);
    await applyDueLatePenalties(pool);
    const params = [];
    const conditions = [];
    if (req.query.billingPeriodId !== undefined) {
      const periodId = Number(req.query.billingPeriodId);
      if (!Number.isSafeInteger(periodId) || periodId <= 0) return res.status(400).json({ message: "A valid billingPeriodId is required." });
      params.push(periodId);
      conditions.push(`b.billing_period_id = $${params.length}`);
    }
    if (req.user.role === "ADMIN" || req.user.role === "RESIDENT") {
      conditions.push("p.status IN ('FORWARDED', 'CLOSED')");
    }
    if (req.user.role === "RESIDENT") {
      conditions.push("b.published_at IS NOT NULL");
      params.push(req.user.id);
      conditions.push(`EXISTS (SELECT 1 FROM unit_assignments access
        WHERE access.unit_id = b.unit_id AND access.user_id = $${params.length} AND access.end_date IS NULL)`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(`${billSelect} ${where} ${groupBy} ORDER BY b.period_start_snapshot DESC, b.unit_number_snapshot`, params);
    return res.json({ bills: result.rows.map((bill) => ({ ...bill, soaTemplate: normalizeSoaTemplate(bill.soaTemplate || defaultSoaTemplate) })) });
  } catch (error) { return next(error); }
});

router.get("/:id", requireId, async (req, res, next) => {
  try {
    await ensureSoaTemplate(pool);
    await ensurePaymentLedgerSchema(pool);
    await applyDueLatePenalties(pool, req.resourceId);
    const params = [req.resourceId];
    const conditions = ["b.id = $1"];
    if (req.user.role === "ADMIN" || req.user.role === "RESIDENT") conditions.push("p.status IN ('FORWARDED', 'CLOSED')");
    if (req.user.role === "RESIDENT") {
      conditions.push("b.published_at IS NOT NULL");
      params.push(req.user.id);
      conditions.push(`EXISTS (SELECT 1 FROM unit_assignments access
        WHERE access.unit_id = b.unit_id AND access.user_id = $2 AND access.end_date IS NULL)`);
    }
    const billResult = await pool.query(`${billSelect} WHERE ${conditions.join(" AND ")} ${groupBy}`, params);
    if (!billResult.rows[0]) return res.status(404).json({ message: "Bill not found." });
    const chargeResult = await pool.query(
      `SELECT id, charge_type AS "chargeType", quantity, rate_applied AS "rateApplied",
        ROUND(quantity * rate_applied, 2) AS amount, description
       FROM bill_charges WHERE unit_bill_id = $1 ORDER BY id`, [req.resourceId],
    );
    return res.json({ bill: { ...billResult.rows[0], soaTemplate: normalizeSoaTemplate(billResult.rows[0].soaTemplate || defaultSoaTemplate), charges: chargeResult.rows } });
  } catch (error) { return next(error); }
});

router.patch("/:id/payment-references", allowRoles("ADMIN", "COLLECTOR"), requireId, validateBody(paymentReferenceSchema), async (req, res, next) => {
  let client;
  try {
    await ensurePaymentLedgerSchema(pool);
    client = await pool.connect();
    await client.query("BEGIN");
    const before = await readBill(client, req.resourceId);
    if (!before) { await client.query("ROLLBACK"); return res.status(404).json({ message: "SOA not found." }); }
    if (Number(before.approvedAmount || 0) <= 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Add payment references after a payment has been approved." });
    }
    const fields = { officialReceiptNumber: "official_receipt_number", invoiceNumber: "invoice_number", paymentNote: "payment_note" };
    const values = [];
    const updates = [];
    for (const [field, column] of Object.entries(fields)) {
      if (req.validatedBody[field] !== undefined) {
        values.push(req.validatedBody[field] || null);
        updates.push(`${column} = $${values.length}`);
      }
    }
    values.push(req.resourceId);
    await client.query(`UPDATE unit_bills SET ${updates.join(", ")} WHERE id = $${values.length}`, values);
    const after = await readBill(client, req.resourceId);
    await writeAuditLog({ client, actorUserId: req.user.id, entityName: "UNIT_BILL", entityId: req.resourceId, action: "PAYMENT_REFERENCES_UPDATED", oldValues: before, newValues: after });
    await client.query("COMMIT");
    return res.json({ message: "SOA payment references updated.", bill: after });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally { client?.release(); }
});

router.patch("/:id", allowRoles("ADMIN", "COLLECTOR"), requireId, validateBody(editBillSchema), async (req, res, next) => {
  let client;
  try {
    await ensureSoaTemplate(pool);
    await ensurePaymentLedgerSchema(pool);
    await ensureBillingErrorSchema(pool);
    client = await pool.connect();
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT b.*, p.status FROM unit_bills b
       JOIN billing_periods p ON p.id = b.billing_period_id
       WHERE b.id = $1 FOR UPDATE OF b, p`, [req.resourceId],
    );
    if (!locked.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Bill not found." }); }
    if (!["GENERATED", "FORWARDED", "CLOSED"].includes(locked.rows[0].status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "This SOA cannot be corrected in its current batch status." });
    }

    const body = req.validatedBody;
    let billingErrorReport = null;
    if (body.billingErrorReportId) {
      const report = await client.query(
        `SELECT id FROM billing_error_reports
         WHERE id = $1 AND unit_bill_id = $2 AND status = 'OPEN' FOR UPDATE`,
        [body.billingErrorReportId, req.resourceId],
      );
      if (!report.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: "The selected open billing-error report is no longer available for this SOA." });
      }
      billingErrorReport = report.rows[0];
    }

    const paymentActivity = await client.query(
      `SELECT EXISTS (SELECT 1 FROM payment_applications pa JOIN payment_submissions ps ON ps.id = pa.payment_submission_id
         WHERE pa.unit_bill_id = $1 AND ps.review_status = 'APPROVED')
       OR EXISTS (SELECT 1 FROM payment_submissions ps WHERE ps.target_unit_bill_id = $1 AND ps.review_status = 'PENDING') AS active`,
      [req.resourceId],
    );
    if (paymentActivity.rows[0].active && !billingErrorReport) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "SOAs with a pending or approved payment can only have billing details corrected from an open Billing Error report." });
    }

    const before = await readBill(client, req.resourceId);
    const current = locked.rows[0];
    const storedPrevious = current.previous_reading_snapshot === null ? null : Number(current.previous_reading_snapshot);
    const storedCurrent = current.current_reading_snapshot === null ? null : Number(current.current_reading_snapshot);
    const previousReading = body.previousReading ?? storedPrevious;
    const currentReading = body.currentReading ?? storedCurrent;
    const periodStart = body.periodStart ?? dateOnly(current.period_start_snapshot);
    const periodEnd = body.periodEnd ?? dateOnly(current.period_end_snapshot);
    const dueDate = body.dueDate ?? dateOnly(current.due_date_snapshot);
    if ((body.previousReading !== undefined || body.currentReading !== undefined)
      && (previousReading === null || currentReading === null)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Provide both previous and current readings to resolve a missing reading warning." });
    }
    if (previousReading !== null && currentReading !== null && currentReading < previousReading) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Current reading cannot be lower than previous reading." });
    }
    if (periodEnd < periodStart || dueDate < periodEnd) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Coverage and due dates are not in a valid order." });
    }

    const columnMap = {
      payerName: "payer_name_snapshot",
      payerEmail: "payer_email_snapshot",
      periodStart: "period_start_snapshot",
      periodEnd: "period_end_snapshot",
      statementDate: "statement_date",
      dueDate: "due_date_snapshot",
      previousReading: "previous_reading_snapshot",
      currentReading: "current_reading_snapshot",
    };
    const values = [];
    const updates = [];
    for (const [field, column] of Object.entries(columnMap)) {
      if (body[field] !== undefined) {
        values.push(body[field] === "" ? null : body[field]);
        updates.push(`${column} = $${values.length}`);
      }
    }
    if (updates.length) {
      if (body.previousReading !== undefined || body.currentReading !== undefined) updates.push("generation_warning = NULL");
      values.push(req.resourceId);
      await client.query(`UPDATE unit_bills SET ${updates.join(", ")} WHERE id = $${values.length}`, values);
    }

    const chargeRows = await client.query("SELECT id, charge_type FROM bill_charges WHERE unit_bill_id = $1 FOR UPDATE", [req.resourceId]);
    const chargeMap = new Map(chargeRows.rows.map((charge) => [Number(charge.id), charge]));
    for (const charge of body.charges || []) {
      const existing = chargeMap.get(Number(charge.id));
      if (!existing) { await client.query("ROLLBACK"); return res.status(400).json({ message: "A submitted charge does not belong to this SOA." }); }
      const chargeValues = [];
      const chargeUpdates = [];
      if (charge.description !== undefined) { chargeValues.push(charge.description); chargeUpdates.push(`description = $${chargeValues.length}`); }
      if (charge.rateApplied !== undefined) { chargeValues.push(charge.rateApplied); chargeUpdates.push(`rate_applied = $${chargeValues.length}`); }
      if (charge.quantity !== undefined && existing.charge_type !== "WATER") { chargeValues.push(charge.quantity); chargeUpdates.push(`quantity = $${chargeValues.length}`); }
      if (chargeUpdates.length) {
        chargeValues.push(charge.id, req.resourceId);
        await client.query(
          `UPDATE bill_charges SET ${chargeUpdates.join(", ")}
           WHERE id = $${chargeValues.length - 1} AND unit_bill_id = $${chargeValues.length}`,
          chargeValues,
        );
      }
    }
    if (body.previousReading !== undefined || body.currentReading !== undefined) {
      const prior = await client.query(
        `SELECT m.current_reading AS "currentReading", p.period_start AS "periodStart"
         FROM meter_readings m JOIN billing_periods p ON p.id = m.billing_period_id
         WHERE m.unit_id = $1 AND p.period_start < (SELECT period_start FROM billing_periods WHERE id = $2)
         ORDER BY p.period_start DESC LIMIT 1`,
        [current.unit_id, current.billing_period_id],
      );
      const quality = validateMeterReading(previousReading, currentReading, prior.rows[0] || null);
      if (quality.status === "FLAGGED") {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: `Correct the meter reading inconsistency before regenerating this SOA: ${quality.notes.join(" ")}` });
      }
      await client.query(
        `UPDATE bill_charges SET quantity = $1,
          description = CASE WHEN description = 'Water charge - reading missing or under review'
            THEN 'Monthly water consumption' ELSE description END
         WHERE unit_bill_id = $2 AND charge_type = 'WATER'`,
        [currentReading - previousReading, req.resourceId],
      );
      await client.query(
        `UPDATE meter_readings SET previous_reading = $1, current_reading = $2, validation_status = $3, validation_notes = $4
         WHERE billing_period_id = $5 AND unit_id = $6`,
        [previousReading, currentReading, quality.status, quality.notes.join(" ") || null, current.billing_period_id, current.unit_id],
      );
    }

    // A Billing Error correction may change a paid bill. Keep payment submissions intact,
    // then recalculate their applications so the revised balance and advance credit reconcile.
    if (paymentActivity.rows[0].active) {
      await client.query("DELETE FROM payment_applications WHERE unit_bill_id = $1", [req.resourceId]);
      await applyUnitCreditToOpenBills(client, current.unit_id, req.resourceId);
    }

    await client.query(
      `UPDATE unit_bills SET soa_revision = COALESCE(soa_revision, 1) + 1,
         corrected_at = NOW(), corrected_by = $2, correction_reason = $3 WHERE id = $1`,
      [req.resourceId, req.user.id, body.reason],
    );
    if (billingErrorReport) {
      await client.query("UPDATE billing_error_reports SET updated_at = NOW() WHERE id = $1", [billingErrorReport.id]);
    }

    const after = await readBill(client, req.resourceId);
    await writeAuditLog({
      client,
      actorUserId: req.user.id,
      entityName: "UNIT_BILL",
      entityId: req.resourceId,
      action: billingErrorReport ? "SOA_EDITED_FROM_BILLING_ERROR" : "SOA_EDITED",
      oldValues: before,
      newValues: after,
      remarks: billingErrorReport ? `Billing error #${billingErrorReport.id}: ${body.reason}` : body.reason,
    });
    let deliveryIds = [];
    if (before.publishedAt) {
      const deliveries = await client.query(
        `UPDATE soa_email_deliveries SET status = 'PENDING'
         WHERE unit_bill_id = $1 AND status IN ('SENT', 'FAILED', 'PENDING') RETURNING id`,
        [req.resourceId],
      );
      deliveryIds = deliveries.rows.map((row) => Number(row.id));
      const recipients = await client.query(
        `SELECT DISTINCT assignment.user_id AS "recipientUserId"
         FROM unit_assignments assignment JOIN users usr ON usr.id = assignment.user_id
         WHERE assignment.unit_id = $1 AND assignment.end_date IS NULL AND usr.is_active = TRUE
           AND assignment.relationship_type IN ('OWNER', 'TENANT')`,
        [current.unit_id],
      );
      await createUserNotifications(client, recipients.rows.map((recipient) => ({
        recipientUserId: recipient.recipientUserId, type: "SOA_CORRECTED", title: "Statement of Account corrected",
        message: "Your Statement of Account was corrected. Please review the updated details.",
        href: `/resident/bills/${req.resourceId}`, dedupeKey: `soa-corrected:${req.resourceId}:${after.soaRevision}`,
      })));
    }
    await client.query("COMMIT");
    let emailSummary = { sent: 0, failed: 0, skipped: deliveryIds.length ? 0 : 1 };
    if (deliveryIds.length) {
      try { emailSummary = { ...emailSummary, ...(await deliverSoaEmailNotifications(deliveryIds)), skipped: 0 }; } catch { emailSummary.failed = deliveryIds.length; }
    }
    return res.json({ message: before.publishedAt ? "Corrected SOA was republished and emailed to residents." : "SOA updated.", bill: after, emailSummary });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally { client?.release(); }
});

export default router;
