import express from "express";
import { z } from "zod";
import pool from "../config/db.js";
import { allowRoles, requireAuth } from "../middleware/authMiddleware.js";
import { requireId, validateBody } from "../middleware/validate.js";
import { billAppliedSql, ensurePaymentLedgerSchema } from "../services/paymentLedger.js";
import { defaultSoaTemplate, ensureSoaTemplate, normalizeSoaTemplate } from "../services/soaTemplate.js";
import { writeAuditLog } from "../services/auditLog.js";

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
}).strict().refine((body) => Object.keys(body).some((key) => key !== "reason"), {
  message: "Change at least one SOA field.",
});

const approvedPaymentSql = billAppliedSql;
const unitAdvanceSql = `COALESCE((SELECT ROUND(SUM(pay.verified_amount - COALESCE((
  SELECT SUM(app.amount_applied) FROM payment_applications app WHERE app.payment_submission_id = pay.id
), 0)), 2) FROM payment_submissions pay WHERE pay.unit_id = b.unit_id AND pay.review_status = 'APPROVED'), 0)`;
const totalChargeSql = `COALESCE(ROUND(SUM(c.quantity * c.rate_applied), 2), 0)`;
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
  b.published_at AS "publishedAt", b.published_by AS "publishedBy",
  COALESCE(b.soa_template_snapshot, (SELECT template_data FROM soa_templates WHERE id = 1)) AS "soaTemplate",
  ${totalChargeSql} AS "totalAmount", ${approvedPaymentSql} AS "approvedAmount",
  ${unitAdvanceSql} AS "advanceBalance",
  GREATEST(${totalChargeSql} - ${approvedPaymentSql}, 0) AS "remainingBalance",
  EXISTS (
    SELECT 1
    FROM payment_submissions pending
    WHERE pending.target_unit_bill_id = b.id AND pending.review_status = 'PENDING'
  ) AS "hasPendingPayment",
  CASE WHEN ${approvedPaymentSql} >= ${totalChargeSql} AND ${totalChargeSql} > 0 THEN 'PAID'
    WHEN ${approvedPaymentSql} > 0 THEN 'PARTIAL'
    WHEN b.due_date_snapshot < CURRENT_DATE THEN 'OVERDUE' ELSE 'UNPAID' END AS "paymentStatus"
  FROM unit_bills b
  JOIN billing_periods p ON p.id = b.billing_period_id
  LEFT JOIN bill_charges c ON c.unit_bill_id = b.id`;
const groupBy = "GROUP BY b.id, p.status, b.soa_template_snapshot";

async function readBill(client, id) {
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

router.patch("/:id", allowRoles("COLLECTOR"), requireId, validateBody(editBillSchema), async (req, res, next) => {
  let client;
  try {
    await ensureSoaTemplate(pool);
    await ensurePaymentLedgerSchema(pool);
    client = await pool.connect();
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT b.*, p.status FROM unit_bills b
       JOIN billing_periods p ON p.id = b.billing_period_id
       WHERE b.id = $1 FOR UPDATE OF b, p`, [req.resourceId],
    );
    if (!locked.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Bill not found." }); }
    if (locked.rows[0].status !== "GENERATED") {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Only generated, unforwarded SOAs can be edited." });
    }

    const before = await readBill(client, req.resourceId);
    const body = req.validatedBody;
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
      await client.query(
        `UPDATE bill_charges SET quantity = $1,
          description = CASE WHEN description = 'Water charge - reading missing or under review'
            THEN 'Monthly water consumption' ELSE description END
         WHERE unit_bill_id = $2 AND charge_type = 'WATER'`,
        [currentReading - previousReading, req.resourceId],
      );
    }

    const after = await readBill(client, req.resourceId);
    await writeAuditLog({
      client,
      actorUserId: req.user.id,
      entityName: "UNIT_BILL",
      entityId: req.resourceId,
      action: "SOA_EDITED",
      oldValues: before,
      newValues: after,
      remarks: body.reason,
    });
    await client.query("COMMIT");
    return res.json({ message: "SOA updated.", bill: after });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally { client?.release(); }
});

export default router;
