import express from "express";
import ExcelJS from "exceljs";
import multer from "multer";
import { z } from "zod";
import pool from "../config/db.js";
import { allowRoles, requireAuth } from "../middleware/authMiddleware.js";
import { requireId, validateBody } from "../middleware/validate.js";
import { regenerateForecastsFromPeriod } from "../services/predictiveAnalytics.js";
import { regeneratePrescriptiveRecommendations } from "../services/prescriptiveAnalytics.js";
import { applyUnitCreditToOpenBills, ensurePaymentLedgerSchema } from "../services/paymentLedger.js";
import { ensureSoaTemplate } from "../services/soaTemplate.js";
import { normalizeSpreadsheetNamespaces } from "../services/workbookCompatibility.js";
import { writeAuditLog } from "../services/auditLog.js";
import { deliverSoaEmailNotifications } from "../services/soaEmailDeliveries.js";

const router = express.Router();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format.");
const createPeriodSchema = z.object({
  periodStart: dateSchema,
  periodEnd: dateSchema,
  dueDate: dateSchema,
  waterRatePerCubicM: z.coerce.number().min(0),
  associationDuesRatePerSqm: z.coerce.number().min(0),
}).strict();
const updatePeriodSchema = createPeriodSchema.partial().refine((body) => Object.keys(body).length > 0, {
  message: "At least one field must be provided.",
});
const readingSchema = z.object({
  unitId: z.coerce.number().int().positive(),
  previousReading: z.coerce.number().min(0),
  currentReading: z.coerce.number().min(0),
}).strict();
const importSchema = z.object({ readings: z.array(readingSchema).min(1).max(1000) }).strict();
const publishSchema = z.object({ billIds: z.array(z.coerce.number().int().positive()).min(1).max(2000).optional() }).strict();
const periodColumns = `id, period_start AS "periodStart", period_end AS "periodEnd",
  due_date AS "dueDate", water_rate_per_cubic_m AS "waterRatePerCubicM",
  association_dues_rate_per_sqm AS "associationDuesRatePerSqm",
  status, created_by AS "createdBy", forwarded_at AS "forwardedAt",
  forwarded_by AS "forwardedBy", period_type AS "periodType",
  readings_visible_at AS "readingsVisibleAt", created_at AS "createdAt", updated_at AS "updatedAt"`;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    const valid = file.originalname.toLowerCase().endsWith(".xlsx")
      || file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    callback(valid ? null : new Error("Only .xlsx files are accepted."), valid);
  },
});

function cellValue(cell) {
  const value = cell?.value;
  if (value && typeof value === "object" && "result" in value) return value.result;
  if (value && typeof value === "object" && "text" in value) return value.text;
  return value;
}

function normalizeUnit(value) {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, "");
  return String(value ?? "").trim().replace(/\.0+$/, "");
}

function numberValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function getDraftPeriod(id) {
  const result = await pool.query(`SELECT ${periodColumns} FROM billing_periods WHERE id = $1 AND period_type = 'LIVE_BILLING'`, [id]);
  return result.rows[0];
}

async function getPreviousReadings(client, periodStart) {
  const result = await client.query(
    `SELECT DISTINCT ON (m.unit_id) m.unit_id AS "unitId", m.current_reading AS "currentReading",
      p.period_start AS "periodStart"
     FROM meter_readings m JOIN billing_periods p ON p.id = m.billing_period_id
     WHERE p.period_start < $1
     ORDER BY m.unit_id, p.period_start DESC`,
    [periodStart],
  );
  return new Map(result.rows.map((row) => [Number(row.unitId), row]));
}

function readingQuality(previousReading, currentReading, priorReading) {
  const notes = [];
  if (currentReading < previousReading) notes.push("Present reading is lower than the previous reading.");
  if (priorReading && Math.abs(Number(priorReading.currentReading) - previousReading) > 0.001) {
    notes.push(`Previous reading does not match the last recorded present reading (${priorReading.currentReading}).`);
  }
  return { status: notes.length ? "FLAGGED" : "VALID", notes };
}

router.use(requireAuth);

router.get("/", allowRoles("ADMIN", "COLLECTOR"), async (req, res, next) => {
  try {
    const where = req.user.role === "ADMIN"
      ? "WHERE period_type = 'LIVE_BILLING' AND status IN ('FORWARDED', 'CLOSED')"
      : "WHERE period_type = 'LIVE_BILLING'";
    const result = await pool.query(`SELECT ${periodColumns} FROM billing_periods ${where} ORDER BY period_start DESC`);
    return res.json({ periods: result.rows });
  } catch (error) { return next(error); }
});

router.post("/", allowRoles("COLLECTOR"), validateBody(createPeriodSchema), async (req, res, next) => {
  try {
    const body = req.validatedBody;
    const result = await pool.query(
      `INSERT INTO billing_periods
        (period_start, period_end, due_date, water_rate_per_cubic_m, association_dues_rate_per_sqm, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${periodColumns}`,
      [body.periodStart, body.periodEnd, body.dueDate, body.waterRatePerCubicM, body.associationDuesRatePerSqm, req.user.id],
    );
    return res.status(201).json({ message: "Billing period created.", period: result.rows[0] });
  } catch (error) { return next(error); }
});

router.patch("/:id", allowRoles("COLLECTOR"), requireId, validateBody(updatePeriodSchema), async (req, res, next) => {
  try {
    const columnMap = {
      periodStart: "period_start",
      periodEnd: "period_end",
      dueDate: "due_date",
      waterRatePerCubicM: "water_rate_per_cubic_m",
      associationDuesRatePerSqm: "association_dues_rate_per_sqm",
    };
    const values = [];
    const updates = [];
    for (const [field, column] of Object.entries(columnMap)) {
      if (req.validatedBody[field] !== undefined) {
        values.push(req.validatedBody[field]);
        updates.push(`${column} = $${values.length}`);
      }
    }
    values.push(req.resourceId);
    const result = await pool.query(
      `UPDATE billing_periods SET ${updates.join(", ")} WHERE id = $${values.length} AND status = 'DRAFT' AND period_type = 'LIVE_BILLING'
       RETURNING ${periodColumns}`,
      values,
    );
    if (!result.rows[0]) return res.status(404).json({ message: "Draft billing period not found." });
    return res.json({ message: "Billing period updated.", period: result.rows[0] });
  } catch (error) { return next(error); }
});

router.post("/:id/readings/preview", allowRoles("COLLECTOR"), requireId, upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Select an .xlsx file." });
    const period = await getDraftPeriod(req.resourceId);
    if (!period) return res.status(404).json({ message: "Billing period not found." });
    if (period.status !== "DRAFT") return res.status(409).json({ message: "Only draft periods accept readings." });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await normalizeSpreadsheetNamespaces(req.file.buffer));
    const sheet = workbook.worksheets[0];
    if (!sheet) return res.status(400).json({ message: "The workbook has no worksheet." });

    const headers = new Map();
    sheet.getRow(1).eachCell((cell, column) => headers.set(String(cellValue(cell) ?? "").trim().toUpperCase(), column));
    const required = ["UNIT", "PREVIOUS", "PRESENT"];
    const missingHeaders = required.filter((header) => !headers.has(header));
    if (missingHeaders.length) return res.status(400).json({ message: `Missing required columns: ${missingHeaders.join(", ")}.` });

    const unitsResult = await pool.query("SELECT id, unit_number FROM units ORDER BY unit_number");
    const priorReadings = await getPreviousReadings(pool, period.periodStart);
    const unitMap = new Map(unitsResult.rows.map((unit) => [String(unit.unit_number).trim().toLowerCase(), unit]));
    const seen = new Set();
    const rows = [];

    for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const unitNumber = normalizeUnit(cellValue(row.getCell(headers.get("UNIT"))));
      const previousReading = numberValue(cellValue(row.getCell(headers.get("PREVIOUS"))));
      const currentReading = numberValue(cellValue(row.getCell(headers.get("PRESENT"))));
      if (!unitNumber && previousReading === null && currentReading === null) continue;
      const errors = [];
      const warnings = [];
      const unit = unitMap.get(unitNumber.toLowerCase());
      if (!unit) errors.push("Unit does not exist in the database.");
      if (seen.has(unitNumber.toLowerCase())) errors.push("Duplicate unit in spreadsheet.");
      seen.add(unitNumber.toLowerCase());
      if (previousReading === null || previousReading < 0) errors.push("Previous reading must be a non-negative number.");
      if (currentReading === null || currentReading < 0) errors.push("Present reading must be a non-negative number.");
      const consumption = previousReading !== null && currentReading !== null ? currentReading - previousReading : null;
      const quality = unit && consumption !== null
        ? readingQuality(previousReading, currentReading, priorReadings.get(Number(unit.id)))
        : { status: "VALID", notes: [] };
      warnings.push(...quality.notes);
      const waterCharge = consumption === null ? null : quality.status === "VALID" ? consumption * Number(period.waterRatePerCubicM) : 0;
      if (headers.has("WRATE")) {
        const fileRate = numberValue(cellValue(row.getCell(headers.get("WRATE"))));
        if (fileRate !== null && Math.abs(fileRate - Number(period.waterRatePerCubicM)) > 0.001) errors.push("Spreadsheet water rate differs from the billing period rate.");
      }
      if (headers.has("CONSUMPTION") && consumption !== null) {
        const fileConsumption = numberValue(cellValue(row.getCell(headers.get("CONSUMPTION"))));
        if (fileConsumption !== null && Math.abs(fileConsumption - consumption) > 0.001) warnings.push("Spreadsheet consumption differs from the server calculation.");
      }
      if (headers.has("WATER BILLED") && waterCharge !== null) {
        const fileCharge = numberValue(cellValue(row.getCell(headers.get("WATER BILLED"))));
        if (fileCharge !== null && Math.abs(fileCharge - waterCharge) > 0.011) warnings.push("Spreadsheet water charge differs from the server calculation.");
      }
      rows.push({ rowNumber, unitId: unit?.id ?? null, unitNumber, previousReading, currentReading, consumption, waterCharge, validationStatus: quality.status, validationNotes: quality.notes.join(" ") || null, errors, warnings });
    }

    const missingUnits = unitsResult.rows.filter((unit) => !seen.has(String(unit.unit_number).trim().toLowerCase())).map((unit) => unit.unit_number);
    const errors = [];
    const warnings = missingUnits.length ? [`Missing meter readings for units: ${missingUnits.join(", ")}. These units will receive a warning and a zero water charge.`] : [];
    const valid = rows.length > 0 && rows.every((row) => row.errors.length === 0);
    return res.json({ valid, period, rows, errors, warnings, summary: { rowCount: rows.length, unitCount: unitsResult.rows.length, missingReadingCount: missingUnits.length, flaggedCount: rows.filter((row) => row.validationStatus === "FLAGGED").length, warningCount: warnings.length + rows.reduce((sum, row) => sum + row.warnings.length, 0) } });
  } catch (error) { return next(error); }
});

router.get("/:id/readings", allowRoles("ADMIN", "COLLECTOR"), requireId, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT m.id, m.unit_id AS "unitId", u.unit_number AS "unitNumber",
        m.previous_reading AS "previousReading", m.current_reading AS "currentReading",
        m.current_reading - m.previous_reading AS consumption, m.validation_status AS "validationStatus",
        m.validation_notes AS "validationNotes"
       FROM meter_readings m JOIN units u ON u.id = m.unit_id
       WHERE m.billing_period_id = $1 ORDER BY u.unit_number`,
      [req.resourceId],
    );
    return res.json({ readings: result.rows });
  } catch (error) { return next(error); }
});

router.put("/:id/readings", allowRoles("COLLECTOR"), requireId, validateBody(importSchema), async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await ensurePaymentLedgerSchema(client);
    await ensureSoaTemplate(client);
    const periodResult = await client.query(
      "SELECT status, period_start, association_dues_rate_per_sqm FROM billing_periods WHERE id = $1 AND period_type = 'LIVE_BILLING' FOR UPDATE",
      [req.resourceId],
    );
    if (!periodResult.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Billing period not found." });
    }
    if (periodResult.rows[0].status !== "DRAFT") {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Only draft periods accept readings." });
    }
    const unitResult = await client.query("SELECT id FROM units ORDER BY id");
    const expected = new Set(unitResult.rows.map((unit) => Number(unit.id)));
    const submitted = new Set(req.validatedBody.readings.map((row) => Number(row.unitId)));
    if (submitted.size !== req.validatedBody.readings.length || [...submitted].some((id) => !expected.has(id))) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Submit unique readings for valid units only." });
    }
    const priorReadings = await getPreviousReadings(client, periodResult.rows[0].period_start);
    await client.query("DELETE FROM meter_readings WHERE billing_period_id = $1", [req.resourceId]);
    for (const row of req.validatedBody.readings) {
      const quality = readingQuality(row.previousReading, row.currentReading, priorReadings.get(Number(row.unitId)));
      await client.query(
        `INSERT INTO meter_readings (unit_id, billing_period_id, recorded_by, previous_reading, current_reading, validation_status, validation_notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (unit_id, billing_period_id) DO UPDATE SET recorded_by = EXCLUDED.recorded_by,
           previous_reading = EXCLUDED.previous_reading, current_reading = EXCLUDED.current_reading,
           validation_status = EXCLUDED.validation_status, validation_notes = EXCLUDED.validation_notes`,
        [row.unitId, req.resourceId, req.user.id, row.previousReading, row.currentReading,
          quality.status, quality.notes.join(" ") || null],
      );
    }
    await regenerateForecastsFromPeriod(client, req.resourceId);
    await regeneratePrescriptiveRecommendations(client);
    await client.query("COMMIT");
    const flaggedCount = req.validatedBody.readings.filter((row) => readingQuality(
      row.previousReading,
      row.currentReading,
      priorReadings.get(Number(row.unitId)),
    ).status === "FLAGGED").length;
    return res.json({ message: `Imported ${req.validatedBody.readings.length} meter readings and generated forecasts.`, flaggedCount });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally { client?.release(); }
});

router.post("/:id/generate", allowRoles("COLLECTOR"), requireId, async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await ensurePaymentLedgerSchema(client);
    await ensureSoaTemplate(client);
    const periodResult = await client.query(
      "SELECT status, association_dues_rate_per_sqm FROM billing_periods WHERE id = $1 AND period_type = 'LIVE_BILLING' FOR UPDATE",
      [req.resourceId],
    );
    if (!periodResult.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Billing period not found." }); }
    if (periodResult.rows[0].status !== "DRAFT") { await client.query("ROLLBACK"); return res.status(409).json({ message: "Bills were already generated for this period." }); }
    if (periodResult.rows[0].association_dues_rate_per_sqm === null) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Set the association-dues rate per square meter before generating bills." });
    }
    const readiness = await client.query(
      `SELECT COUNT(u.id)::int AS "unitCount",
        COUNT(m.id) FILTER (WHERE m.validation_status = 'VALID')::int AS "validCount",
        COUNT(u.billable_area_sqm)::int AS "areaCount",
        ARRAY_AGG(u.unit_number ORDER BY u.unit_number) FILTER (WHERE u.billable_area_sqm IS NULL) AS "missingAreaUnits"
       FROM units u LEFT JOIN meter_readings m ON m.unit_id = u.id AND m.billing_period_id = $1`, [req.resourceId],
    );
    const counts = readiness.rows[0];
    if (counts.unitCount === 0 || counts.areaCount !== counts.unitCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: `Set the billable square-meter area for units: ${(counts.missingAreaUnits || []).join(", ")}.`, ...counts });
    }
    await client.query(
      `INSERT INTO unit_bills
        (unit_id, billing_period_id, generated_by, soa_generated_at,
         unit_number_snapshot, payer_name_snapshot, payer_email_snapshot,
         period_start_snapshot, period_end_snapshot, statement_date, due_date_snapshot,
         previous_reading_snapshot, current_reading_snapshot, generation_warning,
         soa_template_snapshot)
       SELECT u.id, p.id, $2, NOW(), u.unit_number, payer.full_name, payer.email,
         p.period_start, p.period_end, CURRENT_DATE, p.due_date,
         m.previous_reading, m.current_reading,
         CASE
           WHEN m.id IS NULL THEN 'Missing meter reading - water charge set to zero.'
           WHEN m.validation_status <> 'VALID' THEN 'Meter reading requires review - water charge set to zero.'
           ELSE NULL
         END,
         COALESCE(template.template_data, '{}'::jsonb)
       FROM units u
       JOIN billing_periods p ON p.id = $1
       LEFT JOIN LATERAL (SELECT template_data FROM soa_templates WHERE id = 1) template ON TRUE
       LEFT JOIN meter_readings m ON m.unit_id = u.id AND m.billing_period_id = p.id
       LEFT JOIN LATERAL (
         SELECT usr.full_name, usr.email
         FROM unit_assignments a JOIN users usr ON usr.id = a.user_id
         WHERE a.unit_id = u.id AND a.end_date IS NULL
         ORDER BY a.is_primary_payer DESC, a.id LIMIT 1
       ) payer ON TRUE`, [req.resourceId, req.user.id],
    );
    await client.query(
      `INSERT INTO bill_charges (unit_bill_id, charge_type, quantity, rate_applied, description)
       SELECT b.id, 'WATER',
         CASE WHEN m.validation_status = 'VALID' THEN m.current_reading - m.previous_reading ELSE 0 END,
         p.water_rate_per_cubic_m,
         CASE WHEN m.validation_status = 'VALID' THEN 'Monthly water consumption' ELSE 'Water charge - reading missing or under review' END
       FROM unit_bills b
       JOIN billing_periods p ON p.id = b.billing_period_id
       LEFT JOIN meter_readings m ON m.unit_id = b.unit_id AND m.billing_period_id = b.billing_period_id
       WHERE b.billing_period_id = $1`, [req.resourceId],
    );
    await client.query(
      `INSERT INTO bill_charges (unit_bill_id, charge_type, quantity, rate_applied, description)
       SELECT b.id, 'ASSOCIATION_DUES', u.billable_area_sqm,
         p.association_dues_rate_per_sqm, 'Association dues'
       FROM unit_bills b
       JOIN units u ON u.id = b.unit_id
       JOIN billing_periods p ON p.id = b.billing_period_id
       WHERE b.billing_period_id = $1`, [req.resourceId],
    );
    const generatedBills = await client.query("SELECT id, unit_id FROM unit_bills WHERE billing_period_id = $1 ORDER BY id", [req.resourceId]);
    for (const bill of generatedBills.rows) {
      await applyUnitCreditToOpenBills(client, bill.unit_id, bill.id);
    }
    await client.query("UPDATE billing_periods SET status = 'GENERATED' WHERE id = $1", [req.resourceId]);
    await regeneratePrescriptiveRecommendations(client, {
      generatedPeriodId: req.resourceId,
      residentVisibleBy: req.user.id,
    });
    await writeAuditLog({
      client,
      actorUserId: req.user.id,
      entityName: "BILLING_PERIOD",
      entityId: req.resourceId,
      action: "GENERATED",
      newValues: { billCount: counts.unitCount, warningCount: counts.unitCount - counts.validCount },
    });
    await client.query("COMMIT");
    return res.json({ message: `Generated ${counts.unitCount} unit bills with ${counts.unitCount - counts.validCount} reading warning(s).` });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally { client?.release(); }
});

router.post("/:id/reopen", allowRoles("COLLECTOR"), requireId, async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await ensurePaymentLedgerSchema(client);
    const period = await client.query(
      `SELECT id, status, period_start AS "periodStart", period_end AS "periodEnd"
       FROM billing_periods WHERE id = $1 FOR UPDATE`, [req.resourceId],
    );
    if (!period.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Billing period not found." }); }
    if (period.rows[0].status !== "GENERATED") {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Only a generated, unforwarded batch can be reopened." });
    }
    const count = await client.query("SELECT COUNT(*)::int AS count FROM unit_bills WHERE billing_period_id = $1", [req.resourceId]);
    await writeAuditLog({
      client,
      actorUserId: req.user.id,
      entityName: "BILLING_PERIOD",
      entityId: req.resourceId,
      action: "REOPENED",
      oldValues: period.rows[0],
      newValues: { status: "DRAFT", removedBills: count.rows[0].count },
      remarks: req.body?.reason || "Collector reopened the batch for correction.",
    });
    await client.query("DELETE FROM unit_bills WHERE billing_period_id = $1", [req.resourceId]);
    await client.query(
      "UPDATE billing_periods SET status = 'DRAFT', forwarded_at = NULL, forwarded_by = NULL WHERE id = $1",
      [req.resourceId],
    );
    await client.query("COMMIT");
    return res.json({ message: "Batch reopened. Readings were preserved and bills were removed." });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally { client?.release(); }
});

router.post("/:id/forward", allowRoles("COLLECTOR"), requireId, async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE billing_periods
       SET status = 'FORWARDED', forwarded_at = NOW(), forwarded_by = $2
       WHERE id = $1 AND status = 'GENERATED' RETURNING ${periodColumns}`,
      [req.resourceId, req.user.id],
    );
    if (!result.rows[0]) { await client.query("ROLLBACK"); return res.status(409).json({ message: "Only a generated batch can be forwarded." }); }
    await writeAuditLog({
      client,
      actorUserId: req.user.id,
      entityName: "BILLING_PERIOD",
      entityId: req.resourceId,
      action: "FORWARDED",
      newValues: result.rows[0],
    });
    await client.query("COMMIT");
    return res.json({ message: "Billing batch forwarded to Admin.", period: result.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally { client?.release(); }
});

router.post("/:id/publish", allowRoles("ADMIN"), requireId, validateBody(publishSchema), async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const period = await client.query("SELECT id, status FROM billing_periods WHERE id = $1 FOR UPDATE", [req.resourceId]);
    if (!period.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Billing period not found." }); }
    if (!['FORWARDED', 'CLOSED'].includes(period.rows[0].status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Only a batch forwarded to Admin can be published." });
    }
    const selected = req.validatedBody.billIds;
    let result;
    if (selected) {
      const unique = [...new Set(selected)];
      const valid = await client.query("SELECT id FROM unit_bills WHERE billing_period_id = $1 AND id = ANY($2::bigint[])", [req.resourceId, unique]);
      if (valid.rowCount !== unique.length) { await client.query("ROLLBACK"); return res.status(400).json({ message: "One or more selected SOAs do not belong to this batch." }); }
      result = await client.query(
        `UPDATE unit_bills SET published_at = COALESCE(published_at, NOW()), published_by = COALESCE(published_by, $3)
         WHERE billing_period_id = $1 AND id = ANY($2::bigint[]) AND published_at IS NULL
         RETURNING id, unit_id AS "unitId"`,
        [req.resourceId, unique, req.user.id],
      );
    } else {
      result = await client.query(
        `UPDATE unit_bills SET published_at = NOW(), published_by = $2
         WHERE billing_period_id = $1 AND published_at IS NULL RETURNING id, unit_id AS "unitId"`,
        [req.resourceId, req.user.id],
      );
    }
    const publishedBillIds = result.rows.map((row) => Number(row.id));
    let deliveries = { rows: [] };
    if (publishedBillIds.length) {
      deliveries = await client.query(
        `INSERT INTO soa_email_deliveries (unit_bill_id, recipient_user_id, recipient_name, recipient_email)
         SELECT DISTINCT ON (b.id, LOWER(usr.email))
           b.id, usr.id, usr.full_name, LOWER(usr.email)
         FROM unit_bills b
         JOIN unit_assignments assignment ON assignment.unit_id = b.unit_id AND assignment.end_date IS NULL
         JOIN users usr ON usr.id = assignment.user_id AND usr.is_active = TRUE
         WHERE b.id = ANY($1::bigint[]) AND assignment.relationship_type IN ('OWNER', 'TENANT')
           AND NULLIF(TRIM(usr.email), '') IS NOT NULL
         ORDER BY b.id, LOWER(usr.email), assignment.id
         ON CONFLICT (unit_bill_id, recipient_email) DO NOTHING
         RETURNING id, unit_bill_id AS "billId"`,
        [publishedBillIds],
      );
    }
    await writeAuditLog({
      client,
      actorUserId: req.user.id,
      entityName: "BILLING_PERIOD",
      entityId: req.resourceId,
      action: "PUBLISHED",
      newValues: { billIds: result.rows.map((row) => row.id), mode: selected ? "SELECTED" : "ALL" },
    });
    await client.query("COMMIT");

    const deliveryBillIds = new Set(deliveries.rows.map((row) => Number(row.billId)));
    let emailSummary = { sent: 0, failed: 0, skipped: publishedBillIds.length - deliveryBillIds.size };
    try {
      const deliveryResult = await deliverSoaEmailNotifications(deliveries.rows.map((row) => row.id));
      emailSummary = { ...emailSummary, ...deliveryResult };
    } catch (error) {
      console.error("SOA email delivery processing failed:", error);
      emailSummary.failed = deliveries.rowCount;
    }
    return res.json({
      message: result.rowCount ? `Published ${result.rowCount} SOA(s) to Resident dashboards.` : "All selected SOAs were already published.",
      publishedCount: result.rowCount,
      emailSummary,
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally { client?.release(); }
});

router.post("/:id/bills/:billId/email-deliveries/retry", allowRoles("ADMIN"), requireId, async (req, res, next) => {
  const billId = Number(req.params.billId);
  if (!Number.isSafeInteger(billId) || billId <= 0) return res.status(400).json({ message: "A valid bill ID is required." });

  try {
    const bill = await pool.query(
      `SELECT b.id
       FROM unit_bills b JOIN billing_periods p ON p.id = b.billing_period_id
       WHERE b.id = $1 AND b.billing_period_id = $2
         AND b.published_at IS NOT NULL AND p.status IN ('FORWARDED', 'CLOSED')`,
      [billId, req.resourceId],
    );
    if (!bill.rows[0]) return res.status(404).json({ message: "Published SOA not found in this billing batch." });

    const retries = await pool.query(
      `UPDATE soa_email_deliveries SET status = 'PENDING'
       WHERE unit_bill_id = $1 AND status = 'FAILED'
       RETURNING id`,
      [billId],
    );
    if (!retries.rowCount) return res.json({ message: "There are no failed SOA emails to retry.", emailSummary: { sent: 0, failed: 0, skipped: 0 } });

    const deliveryResult = await deliverSoaEmailNotifications(retries.rows.map((row) => row.id));
    await writeAuditLog({
      actorUserId: req.user.id,
      entityName: "SOA_EMAIL_DELIVERY",
      entityId: billId,
      action: "RETRIED",
      newValues: deliveryResult,
    });
    return res.json({
      message: `Retried ${retries.rowCount} failed SOA email(s).`,
      emailSummary: { ...deliveryResult, skipped: 0 },
    });
  } catch (error) { return next(error); }
});

router.post("/:id/bills/:billId/email-deliveries/resend", allowRoles("ADMIN"), requireId, async (req, res, next) => {
  const billId = Number(req.params.billId);
  if (!Number.isSafeInteger(billId) || billId <= 0) return res.status(400).json({ message: "A valid bill ID is required." });

  try {
    const bill = await pool.query(
      `SELECT b.id
       FROM unit_bills b JOIN billing_periods p ON p.id = b.billing_period_id
       WHERE b.id = $1 AND b.billing_period_id = $2
         AND b.published_at IS NOT NULL AND p.status IN ('FORWARDED', 'CLOSED')`,
      [billId, req.resourceId],
    );
    if (!bill.rows[0]) return res.status(404).json({ message: "Published SOA not found in this billing batch." });

    const resend = await pool.query(
      `UPDATE soa_email_deliveries SET status = 'PENDING'
       WHERE unit_bill_id = $1 AND status IN ('SENT', 'FAILED')
       RETURNING id`,
      [billId],
    );
    if (!resend.rowCount) return res.status(409).json({ message: "This SOA has no saved recipient email to resend." });

    const deliveryResult = await deliverSoaEmailNotifications(resend.rows.map((row) => row.id));
    await writeAuditLog({
      actorUserId: req.user.id,
      entityName: "SOA_EMAIL_DELIVERY",
      entityId: billId,
      action: "RESENT",
      newValues: deliveryResult,
    });
    return res.json({
      message: `Resent the SOA to ${resend.rowCount} saved recipient${resend.rowCount === 1 ? '' : 's'}.`,
      emailSummary: { ...deliveryResult, skipped: 0 },
    });
  } catch (error) { return next(error); }
});

router.delete("/:id", allowRoles("COLLECTOR"), requireId, async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await ensurePaymentLedgerSchema(client);
    const period = await client.query(
      `SELECT id, status, period_start AS "periodStart", period_end AS "periodEnd"
       FROM billing_periods WHERE id = $1 FOR UPDATE`, [req.resourceId],
    );
    if (!period.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Billing period not found." }); }
    if (!['DRAFT', 'GENERATED', 'FORWARDED'].includes(period.rows[0].status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Closed billing batches cannot be deleted." });
    }
    const protectedBills = await client.query(
      `SELECT COUNT(*)::int AS count FROM unit_bills b
       WHERE b.billing_period_id = $1 AND (
         EXISTS (SELECT 1 FROM payment_submissions ps WHERE ps.target_unit_bill_id = b.id)
         OR EXISTS (SELECT 1 FROM payment_applications pa WHERE pa.unit_bill_id = b.id)
       )`, [req.resourceId],
    );
    if (protectedBills.rows[0].count > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "A batch with payment history cannot be deleted." });
    }
    const readingCount = await client.query("SELECT COUNT(*)::int AS count FROM meter_readings WHERE billing_period_id = $1", [req.resourceId]);
    const billCount = await client.query("SELECT COUNT(*)::int AS count FROM unit_bills WHERE billing_period_id = $1", [req.resourceId]);
    await writeAuditLog({
      client,
      actorUserId: req.user.id,
      entityName: "BILLING_PERIOD",
      entityId: req.resourceId,
      action: "DELETED",
      oldValues: { ...period.rows[0], readingCount: readingCount.rows[0].count, billCount: billCount.rows[0].count },
      remarks: req.body?.reason || "Collector permanently deleted the billing batch.",
    });
    await client.query("DELETE FROM unit_bills WHERE billing_period_id = $1", [req.resourceId]);
    await client.query("DELETE FROM meter_readings WHERE billing_period_id = $1", [req.resourceId]);
    await client.query("DELETE FROM billing_periods WHERE id = $1", [req.resourceId]);
    await client.query("COMMIT");
    return res.json({ message: "Billing batch, readings, SOAs, and charges permanently deleted." });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally { client?.release(); }
});

export default router;
