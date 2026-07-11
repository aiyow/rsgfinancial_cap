import express from "express";
import ExcelJS from "exceljs";
import multer from "multer";
import { z } from "zod";
import pool from "../config/db.js";
import { allowRoles, requireAuth } from "../middleware/authMiddleware.js";
import { regenerateForecastsFromPeriod } from "../services/predictiveAnalytics.js";
import { regeneratePrescriptiveRecommendations } from "../services/prescriptiveAnalytics.js";
import { normalizeSpreadsheetNamespaces } from "../services/workbookCompatibility.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    const valid = file.originalname.toLowerCase().endsWith(".xlsx")
      || file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    callback(valid ? null : new Error("Only .xlsx files are accepted."), valid);
  },
});

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM format.");
const readingSchema = z.object({
  unitId: z.coerce.number().int().positive(),
  previousReading: z.coerce.number().min(0),
  currentReading: z.coerce.number().min(0),
}).strict();
const importSchema = z.object({
  periodMonth: monthSchema,
  waterRatePerCubicM: z.coerce.number().min(0),
  readings: z.array(readingSchema).min(1).max(2000),
}).strict();

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

function periodDates(periodMonth) {
  const [year, month] = periodMonth.split("-").map(Number);
  const periodStart = `${periodMonth}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const periodEnd = `${periodMonth}-${String(lastDay).padStart(2, "0")}`;
  return { periodStart, periodEnd };
}

function monthFromDate(value) {
  return String(value).slice(0, 7);
}

function readingQuality(previousReading, currentReading, priorReading) {
  const notes = [];
  if (currentReading < previousReading) notes.push("Present reading is lower than the previous reading.");
  if (priorReading !== undefined && Math.abs(Number(priorReading) - previousReading) > 0.001) {
    notes.push(`Previous reading does not match the last recorded present reading (${priorReading}).`);
  }
  return { status: notes.length ? "FLAGGED" : "VALID", notes };
}

async function parseWorkbook(buffer, units) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await normalizeSpreadsheetNamespaces(buffer));
  const sheet = workbook.worksheets[0];
  if (!sheet) return { valid: false, rows: [], errors: ["The workbook has no worksheet."], warnings: [], waterRate: null };

  const headers = new Map();
  sheet.getRow(1).eachCell((cell, column) => headers.set(String(cellValue(cell) ?? "").trim().toUpperCase(), column));
  const required = ["UNIT", "PREVIOUS", "PRESENT", "CONSUMPTION", "WRATE", "WATER BILLED"];
  const missingHeaders = required.filter((header) => !headers.has(header));
  if (missingHeaders.length) {
    return { valid: false, rows: [], errors: [`Missing required columns: ${missingHeaders.join(", ")}.`], warnings: [], waterRate: null };
  }

  const unitMap = new Map(units.map((unit) => [String(unit.unit_number).trim().toLowerCase(), unit]));
  const seen = new Set();
  const rows = [];
  const errors = [];
  const warnings = [];
  let waterRate = null;

  for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const unitNumber = normalizeUnit(cellValue(row.getCell(headers.get("UNIT"))));
    const previousReading = numberValue(cellValue(row.getCell(headers.get("PREVIOUS"))));
    const currentReading = numberValue(cellValue(row.getCell(headers.get("PRESENT"))));
    const fileConsumption = numberValue(cellValue(row.getCell(headers.get("CONSUMPTION"))));
    const fileRate = numberValue(cellValue(row.getCell(headers.get("WRATE"))));
    const fileCharge = numberValue(cellValue(row.getCell(headers.get("WATER BILLED"))));
    if (!unitNumber && previousReading === null && currentReading === null && fileRate === null) continue;

    const rowErrors = [];
    const rowWarnings = [];
    const unit = unitMap.get(unitNumber.toLowerCase());
    if (!unit) rowErrors.push("Unit does not exist in the database.");
    if (seen.has(unitNumber.toLowerCase())) rowErrors.push("Duplicate unit in spreadsheet.");
    seen.add(unitNumber.toLowerCase());
    if (previousReading === null || previousReading < 0) rowErrors.push("Previous reading must be a non-negative number.");
    if (currentReading === null || currentReading < 0) rowErrors.push("Present reading must be a non-negative number.");
    if (fileRate === null || fileRate < 0) rowErrors.push("Water rate must be a non-negative number.");
    if (waterRate !== null && fileRate !== null && Math.abs(waterRate - fileRate) > 0.001) rowErrors.push("Workbook contains multiple water rates.");
    if (waterRate === null && fileRate !== null) waterRate = fileRate;

    const consumption = previousReading !== null && currentReading !== null ? currentReading - previousReading : null;
    const waterCharge = consumption !== null && fileRate !== null ? consumption * fileRate : null;
    if (consumption !== null && consumption < 0) rowWarnings.push("Present reading is lower than the previous reading and will be flagged.");
    if (fileConsumption !== null && consumption !== null && Math.abs(fileConsumption - consumption) > 0.001) {
      rowWarnings.push("Spreadsheet consumption differs from the server calculation.");
    }
    if (fileCharge !== null && waterCharge !== null && Math.abs(fileCharge - waterCharge) > 0.011) {
      rowWarnings.push("Spreadsheet water charge differs from the server calculation.");
    }

    rows.push({
      rowNumber,
      unitId: unit?.id ?? null,
      unitNumber,
      previousReading,
      currentReading,
      consumption,
      waterCharge,
      errors: rowErrors,
      warnings: rowWarnings,
    });
  }

  const missingUnits = units
    .filter((unit) => !seen.has(String(unit.unit_number).trim().toLowerCase()))
    .map((unit) => unit.unit_number);
  if (missingUnits.length) errors.push(`Missing meter readings for units: ${missingUnits.join(", ")}.`);
  if (rows.length === 0) errors.push("The workbook does not contain any meter readings.");

  const rowErrorCount = rows.reduce((sum, row) => sum + row.errors.length, 0);
  return {
    valid: errors.length === 0 && rowErrorCount === 0,
    rows,
    errors,
    warnings,
    waterRate,
    summary: {
      rowCount: rows.length,
      unitCount: units.length,
      missingReadingCount: missingUnits.length,
      errorCount: errors.length + rowErrorCount,
      warningCount: warnings.length + rows.reduce((sum, row) => sum + row.warnings.length, 0),
    },
  };
}

async function revalidateAnalyticsReadings(client) {
  const result = await client.query(
    `SELECT m.id, m.unit_id AS "unitId", m.previous_reading AS "previousReading",
      m.current_reading AS "currentReading"
     FROM meter_readings m
     JOIN billing_periods p ON p.id = m.billing_period_id
     WHERE p.analytics_only = TRUE
     ORDER BY m.unit_id, p.period_start`,
  );
  const priorByUnit = new Map();
  for (const row of result.rows) {
    const quality = readingQuality(Number(row.previousReading), Number(row.currentReading), priorByUnit.get(Number(row.unitId)));
    await client.query(
      "UPDATE meter_readings SET validation_status = $2, validation_notes = $3 WHERE id = $1",
      [row.id, quality.status, quality.notes.join(" ") || null],
    );
    priorByUnit.set(Number(row.unitId), Number(row.currentReading));
  }
}

async function deleteForecastsFrom(client, periodStart) {
  await client.query(
    `DELETE FROM billing_forecasts
     WHERE based_on_period_id IN (
       SELECT id FROM billing_periods WHERE period_start >= $1
     )`,
    [periodStart],
  );
}

async function nextForecastPeriodId(client, periodStart) {
  const result = await client.query(
    `SELECT id FROM billing_periods
     WHERE period_start >= $1
     ORDER BY period_start LIMIT 1`,
    [periodStart],
  );
  return result.rows[0]?.id ?? null;
}

async function verifyLiveBillingReadings(client, billingPeriodId, readings) {
  const result = await client.query(
    `SELECT unit_id AS "unitId", previous_reading AS "previousReading", current_reading AS "currentReading"
     FROM meter_readings WHERE billing_period_id = $1`,
    [billingPeriodId],
  );
  const submittedByUnit = new Map(readings.map((reading) => [Number(reading.unitId), reading]));
  if (result.rowCount !== submittedByUnit.size) return "The workbook does not contain the same number of saved billing readings.";

  for (const saved of result.rows) {
    const imported = submittedByUnit.get(Number(saved.unitId));
    if (!imported
      || Math.abs(Number(saved.previousReading) - Number(imported.previousReading)) > 0.001
      || Math.abs(Number(saved.currentReading) - Number(imported.currentReading)) > 0.001) {
      return "The workbook readings do not match the saved billing data.";
    }
  }
  return null;
}

router.use(requireAuth);
router.use(allowRoles("COLLECTOR"));

router.get("/", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.period_start AS "periodStart", p.period_end AS "periodEnd",
        p.water_rate_per_cubic_m AS "waterRatePerCubicM", p.readings_visible_at AS "readingsVisibleAt",
        COUNT(DISTINCT m.id)::int AS "readingCount",
        COUNT(DISTINCT m.id) FILTER (WHERE m.validation_status = 'FLAGGED')::int AS "flaggedCount",
        MAX(f.forecast_for_month) AS "forecastForMonth",
        COUNT(DISTINCT f.id) FILTER (WHERE f.forecast_status = 'READY')::int AS "readyForecastCount"
       FROM billing_periods p
       LEFT JOIN meter_readings m ON m.billing_period_id = p.id
       LEFT JOIN billing_forecasts f ON f.based_on_period_id = p.id
       WHERE p.analytics_only = TRUE
       GROUP BY p.id
       ORDER BY p.period_start DESC`,
    );
    return res.json({ imports: result.rows.map((row) => ({ ...row, periodMonth: monthFromDate(row.periodStart) })) });
  } catch (error) { return next(error); }
});

router.post("/preview", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Select an .xlsx file." });
    const parsedMonth = monthSchema.safeParse(req.body.periodMonth);
    if (!parsedMonth.success) return res.status(400).json({ message: "Select a valid month." });
    const { periodStart } = periodDates(parsedMonth.data);
    const existing = await pool.query("SELECT analytics_only AS \"analyticsOnly\" FROM billing_periods WHERE period_start = $1", [periodStart]);
    const unitsResult = await pool.query("SELECT id, unit_number FROM units ORDER BY unit_number");
    const preview = await parseWorkbook(req.file.buffer, unitsResult.rows);
    return res.json({
      periodMonth: parsedMonth.data,
      usesExistingLiveBilling: Boolean(existing.rows[0] && !existing.rows[0].analyticsOnly),
      ...preview,
      summary: {
        rowCount: preview.summary?.rowCount || 0,
        unitCount: preview.summary?.unitCount || unitsResult.rowCount,
        missingReadingCount: preview.summary?.missingReadingCount || 0,
        flaggedCount: preview.rows.filter((row) => row.currentReading !== null && row.previousReading !== null && row.currentReading < row.previousReading).length,
        errorCount: preview.summary?.errorCount || preview.errors.length,
        warningCount: preview.summary?.warningCount || preview.warnings.length,
      },
    });
  } catch (error) { return next(error); }
});

router.post("/", async (req, res, next) => {
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid import payload." });

  let client;
  try {
    const body = parsed.data;
    const { periodStart, periodEnd } = periodDates(body.periodMonth);
    client = await pool.connect();
    await client.query("BEGIN");

    const existing = await client.query(
      "SELECT id, analytics_only AS \"analyticsOnly\", water_rate_per_cubic_m AS \"waterRate\" FROM billing_periods WHERE period_start = $1 FOR UPDATE",
      [periodStart],
    );

    const unitsResult = await client.query("SELECT id FROM units ORDER BY id");
    const expected = new Set(unitsResult.rows.map((unit) => Number(unit.id)));
    const submitted = new Set(body.readings.map((row) => Number(row.unitId)));
    if (submitted.size !== body.readings.length || submitted.size !== expected.size || [...submitted].some((id) => !expected.has(id))) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Submit one reading for every valid unit only." });
    }

    if (existing.rows[0] && !existing.rows[0].analyticsOnly) {
      const livePeriod = existing.rows[0];
      if (Math.abs(Number(livePeriod.waterRate) - Number(body.waterRatePerCubicM)) > 0.001) {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: "The workbook water rate does not match the saved live billing batch." });
      }
      const mismatch = await verifyLiveBillingReadings(client, livePeriod.id, body.readings);
      if (mismatch) {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: `${mismatch} Update the billing batch instead.` });
      }
      await regenerateForecastsFromPeriod(client, livePeriod.id);
      await regeneratePrescriptiveRecommendations(client);
      await client.query("COMMIT");
      return res.json({
        message: `Verified the saved ${body.periodMonth} billing readings and refreshed predictions.`,
        reusedLiveBilling: true,
      });
    }

    await deleteForecastsFrom(client, periodStart);

    let periodId = existing.rows[0]?.id;
    if (periodId) {
      await client.query(
        `UPDATE billing_periods
         SET period_end = $2, due_date = $2, water_rate_per_cubic_m = $3,
           association_dues_rate_per_sqm = 0, status = 'CLOSED',
           created_by = $4, readings_visible_at = NOW()
         WHERE id = $1`,
        [periodId, periodEnd, body.waterRatePerCubicM, req.user.id],
      );
      await client.query("DELETE FROM meter_readings WHERE billing_period_id = $1", [periodId]);
    } else {
      const inserted = await client.query(
        `INSERT INTO billing_periods
          (period_start, period_end, due_date, water_rate_per_cubic_m,
           association_dues_rate_per_sqm, status, created_by, analytics_only, readings_visible_at)
         VALUES ($1, $2, $2, $3, 0, 'CLOSED', $4, TRUE, NOW())
         RETURNING id`,
        [periodStart, periodEnd, body.waterRatePerCubicM, req.user.id],
      );
      periodId = inserted.rows[0].id;
    }

    for (const row of body.readings) {
      const localQuality = readingQuality(row.previousReading, row.currentReading);
      await client.query(
        `INSERT INTO meter_readings
          (unit_id, billing_period_id, recorded_by, previous_reading, current_reading, validation_status, validation_notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [row.unitId, periodId, req.user.id, row.previousReading, row.currentReading,
          localQuality.status, localQuality.notes.join(" ") || null],
      );
    }

    await revalidateAnalyticsReadings(client);
    await regenerateForecastsFromPeriod(client, periodId);
    await regeneratePrescriptiveRecommendations(client);
    await client.query("COMMIT");
    return res.status(201).json({ message: `Imported ${body.readings.length} readings for ${body.periodMonth} and updated predictions.` });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally { client?.release(); }
});

router.delete("/:periodMonth", async (req, res, next) => {
  const parsedMonth = monthSchema.safeParse(req.params.periodMonth);
  if (!parsedMonth.success) return res.status(400).json({ message: "Use YYYY-MM format." });

  let client;
  try {
    const { periodStart } = periodDates(parsedMonth.data);
    client = await pool.connect();
    await client.query("BEGIN");
    const period = await client.query(
      "SELECT id FROM billing_periods WHERE period_start = $1 AND analytics_only = TRUE FOR UPDATE",
      [periodStart],
    );
    if (!period.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Imported analytics month not found." });
    }
    await deleteForecastsFrom(client, periodStart);
    await client.query("DELETE FROM meter_readings WHERE billing_period_id = $1", [period.rows[0].id]);
    await client.query("DELETE FROM billing_periods WHERE id = $1", [period.rows[0].id]);
    await revalidateAnalyticsReadings(client);
    const nextPeriodId = await nextForecastPeriodId(client, periodStart);
    if (nextPeriodId) await regenerateForecastsFromPeriod(client, nextPeriodId);
    await regeneratePrescriptiveRecommendations(client);
    await client.query("COMMIT");
    return res.json({ message: `Removed imported analytics data for ${parsedMonth.data}.` });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally { client?.release(); }
});

router.delete("/", async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const periods = await client.query("SELECT id FROM billing_periods WHERE analytics_only = TRUE FOR UPDATE");
    const ids = periods.rows.map((period) => period.id);
    if (ids.length) {
      await client.query("DELETE FROM billing_forecasts WHERE based_on_period_id = ANY($1::bigint[])", [ids]);
      await client.query("DELETE FROM meter_readings WHERE billing_period_id = ANY($1::bigint[])", [ids]);
      await client.query("DELETE FROM billing_periods WHERE id = ANY($1::bigint[])", [ids]);
    }
    const firstLivePeriod = await client.query(
      "SELECT id FROM billing_periods WHERE analytics_only = FALSE ORDER BY period_start LIMIT 1",
    );
    if (firstLivePeriod.rows[0]) await regenerateForecastsFromPeriod(client, firstLivePeriod.rows[0].id);
    await regeneratePrescriptiveRecommendations(client);
    await client.query("COMMIT");
    return res.json({ message: "Cleared imported analytics history." });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally { client?.release(); }
});

export default router;
