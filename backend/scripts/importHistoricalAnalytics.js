import "dotenv/config";
import ExcelJS from "exceljs";
import { homedir } from "node:os";
import path from "node:path";
import pool from "../config/db.js";
import { writeAuditLog } from "../services/auditLog.js";
import { regenerateForecastsFromPeriod } from "../services/predictiveAnalytics.js";
import { normalizeSpreadsheetNamespaces } from "../services/workbookCompatibility.js";

const monthNumbers = new Map([
  ["january", 1], ["february", 2], ["march", 3],
  ["april", 4], ["may", 5], ["june", 6],
]);

const defaultFiles = ["January", "February", "March", "April", "May"].map((month) => (
  path.join(homedir(), "Downloads", `${month}_2026_Billing_Cleaned.xlsx`)
));

function cellValue(cell) {
  const value = cell?.value;
  if (value && typeof value === "object" && "result" in value) return value.result;
  if (value && typeof value === "object" && "text" in value) return value.text;
  return value;
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function unitNumber(value) {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, "");
  return String(value ?? "").trim().replace(/\.0+$/, "");
}

function dateFor(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function lastDay(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function filePeriod(filePath) {
  const match = path.basename(filePath).match(/(January|February|March|April|May|June)_(\d{4})_Billing_Cleaned\.xlsx$/i);
  if (!match) throw new Error(`Cannot determine the billing month from ${path.basename(filePath)}.`);
  return { year: Number(match[2]), month: monthNumbers.get(match[1].toLowerCase()) };
}

async function readWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(filePath));
  await workbook.xlsx.load(await normalizeSpreadsheetNamespaces(source));
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error(`${path.basename(filePath)} has no worksheet.`);
  const headers = new Map();
  sheet.getRow(1).eachCell((cell, column) => headers.set(String(cellValue(cell) ?? "").trim().toUpperCase(), column));
  for (const header of ["UNIT", "PREVIOUS", "PRESENT", "CONSUMPTION", "WRATE", "WATER BILLED"]) {
    if (!headers.has(header)) throw new Error(`${path.basename(filePath)} is missing ${header}.`);
  }

  const readings = new Map();
  let waterRate = null;
  for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const unit = unitNumber(cellValue(row.getCell(headers.get("UNIT"))));
    if (!unit) continue;
    if (readings.has(unit)) throw new Error(`${path.basename(filePath)} contains duplicate Unit ${unit}.`);
    const previous = numberValue(cellValue(row.getCell(headers.get("PREVIOUS"))));
    const current = numberValue(cellValue(row.getCell(headers.get("PRESENT"))));
    const fileConsumption = numberValue(cellValue(row.getCell(headers.get("CONSUMPTION"))));
    const rate = numberValue(cellValue(row.getCell(headers.get("WRATE"))));
    const fileCharge = numberValue(cellValue(row.getCell(headers.get("WATER BILLED"))));
    if ([previous, current, rate].some((value) => value === null)) {
      throw new Error(`${path.basename(filePath)} row ${rowNumber} contains a non-numeric meter reading or water rate.`);
    }
    const consumption = current - previous;
    // Some zero-result formulas have no cached value in the cleaned files.
    // The system always recalculates them from the raw readings and rate.
    if (fileConsumption !== null && Math.abs(consumption - fileConsumption) > 0.001) throw new Error(`${path.basename(filePath)} row ${rowNumber} has an incorrect consumption formula.`);
    if (fileCharge !== null && Math.abs((consumption * rate) - fileCharge) > 0.011) throw new Error(`${path.basename(filePath)} row ${rowNumber} has an incorrect water charge.`);
    if (waterRate !== null && Math.abs(waterRate - rate) > 0.001) throw new Error(`${path.basename(filePath)} contains multiple water rates.`);
    waterRate = rate;
    readings.set(unit, { previous, current });
  }
  return { filePath, ...filePeriod(filePath), readings, waterRate };
}

async function revalidateTimeline(client) {
  const result = await client.query(
    `SELECT m.id, m.unit_id AS "unitId", m.previous_reading AS previous,
      m.current_reading AS current, p.period_start AS "periodStart"
     FROM meter_readings m JOIN billing_periods p ON p.id = m.billing_period_id
     WHERE p.period_start BETWEEN '2026-01-01' AND '2026-05-31'
     ORDER BY m.unit_id, p.period_start`,
  );
  const priorByUnit = new Map();
  const flags = [];
  for (const reading of result.rows) {
    const previous = Number(reading.previous);
    const current = Number(reading.current);
    const prior = priorByUnit.get(Number(reading.unitId));
    const notes = [];
    if (current < previous) notes.push("Present reading is lower than the previous reading.");
    if (prior !== undefined && Math.abs(prior - previous) > 0.001) notes.push("Previous reading does not match the last recorded present reading.");
    const status = notes.length ? "FLAGGED" : "VALID";
    await client.query(
      "UPDATE meter_readings SET validation_status = $2, validation_notes = $3 WHERE id = $1",
      [reading.id, status, notes.join(" ") || null],
    );
    if (notes.length) flags.push({ id: reading.id, unitId: reading.unitId, periodStart: reading.periodStart, notes });
    priorByUnit.set(Number(reading.unitId), current);
  }
  return flags;
}

async function run() {
  const files = process.argv.slice(2).length ? process.argv.slice(2) : defaultFiles;
  const workbooks = (await Promise.all(files.map(readWorkbook))).sort((a, b) => (a.year * 12 + a.month) - (b.year * 12 + b.month));
  const expected = [1, 2, 3, 4, 5];
  if (workbooks.length !== expected.length || workbooks.some((book, index) => book.year !== 2026 || book.month !== expected[index])) {
    throw new Error("Provide exactly the January through May 2026 cleaned workbooks.");
  }

  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const collector = await client.query("SELECT id FROM users WHERE role = 'COLLECTOR' AND is_active = TRUE ORDER BY id LIMIT 1");
    if (!collector.rows[0]) throw new Error("An active Collector account is required for historical attribution.");
    const unitsResult = await client.query("SELECT id, unit_number FROM units ORDER BY unit_number");
    const units = new Map(unitsResult.rows.map((unit) => [String(unit.unit_number).trim().toLowerCase(), unit]));
    for (const workbook of workbooks) {
      if (workbook.readings.size !== units.size) throw new Error(`${path.basename(workbook.filePath)} has ${workbook.readings.size} units; the database has ${units.size}.`);
      for (const unit of workbook.readings.keys()) if (!units.has(unit.toLowerCase())) throw new Error(`Unit ${unit} from ${path.basename(workbook.filePath)} does not exist.`);
    }

    let firstPeriodId = null;
    for (const workbook of workbooks) {
      const periodStart = dateFor(workbook.year, workbook.month, 1);
      const periodEnd = dateFor(workbook.year, workbook.month, lastDay(workbook.year, workbook.month));
      let period = await client.query(
        `SELECT id, analytics_only AS "analyticsOnly" FROM billing_periods WHERE period_start = $1 FOR UPDATE`,
        [periodStart],
      );
      if (!period.rows[0]) {
        period = await client.query(
          `INSERT INTO billing_periods
            (period_start, period_end, due_date, water_rate_per_cubic_m,
             association_dues_rate_per_sqm, status, created_by, analytics_only, readings_visible_at)
           VALUES ($1, $2, $2, $3, 0, 'CLOSED', $4, TRUE, NOW())
           RETURNING id, analytics_only AS "analyticsOnly"`,
          [periodStart, periodEnd, workbook.waterRate, collector.rows[0].id],
        );
      }
      const currentPeriod = period.rows[0];
      if (!firstPeriodId) firstPeriodId = currentPeriod.id;

      if (!currentPeriod.analyticsOnly) {
        const stored = await client.query(
          `SELECT u.unit_number AS "unitNumber", m.previous_reading AS previous, m.current_reading AS current
           FROM meter_readings m JOIN units u ON u.id = m.unit_id
           WHERE m.billing_period_id = $1`,
          [currentPeriod.id],
        );
        if (stored.rowCount !== workbook.readings.size) throw new Error(`${periodStart} already exists but its stored readings are incomplete.`);
        for (const reading of stored.rows) {
          const expectedReading = workbook.readings.get(String(reading.unitNumber));
          if (!expectedReading || Math.abs(Number(reading.previous) - expectedReading.previous) > 0.001 || Math.abs(Number(reading.current) - expectedReading.current) > 0.001) {
            throw new Error(`${periodStart} already exists and does not match the supplied workbook for Unit ${reading.unitNumber}.`);
          }
        }
        await client.query("UPDATE billing_periods SET readings_visible_at = COALESCE(readings_visible_at, NOW()) WHERE id = $1", [currentPeriod.id]);
        continue;
      }

      const billCount = await client.query("SELECT COUNT(*)::int AS count FROM unit_bills WHERE billing_period_id = $1", [currentPeriod.id]);
      if (billCount.rows[0].count !== 0) throw new Error(`Analytics-only period ${periodStart} unexpectedly has SOAs.`);
      await client.query("UPDATE billing_periods SET readings_visible_at = COALESCE(readings_visible_at, NOW()) WHERE id = $1", [currentPeriod.id]);
      for (const [number, reading] of workbook.readings) {
        const unit = units.get(number.toLowerCase());
        const localStatus = reading.current < reading.previous ? "FLAGGED" : "VALID";
        await client.query(
          `INSERT INTO meter_readings
            (unit_id, billing_period_id, recorded_by, previous_reading, current_reading, validation_status, validation_notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (unit_id, billing_period_id) DO UPDATE SET
             recorded_by = EXCLUDED.recorded_by, previous_reading = EXCLUDED.previous_reading,
             current_reading = EXCLUDED.current_reading, validation_status = EXCLUDED.validation_status,
             validation_notes = EXCLUDED.validation_notes`,
          [unit.id, currentPeriod.id, collector.rows[0].id, reading.previous, reading.current, localStatus,
            localStatus === "FLAGGED" ? "Present reading is lower than the previous reading." : null],
        );
      }
    }

    const flags = await revalidateTimeline(client);
    if (flags.length !== 5) throw new Error(`Expected 5 genuine January-May reading flags, found ${flags.length}.`);
    await regenerateForecastsFromPeriod(client, firstPeriodId);
    const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"];
    const existingAudit = await client.query(
      `SELECT 1 FROM audit_logs
       WHERE action = 'HISTORICAL_IMPORT' AND entity_name = 'BILLING_PERIOD'
         AND new_values @> $1::jsonb LIMIT 1`,
      [JSON.stringify({ months })],
    );
    if (!existingAudit.rows[0]) {
      await writeAuditLog({
        client,
        actorUserId: collector.rows[0].id,
        entityName: "BILLING_PERIOD",
        entityId: firstPeriodId,
        action: "HISTORICAL_IMPORT",
        newValues: { months, readingsPerMonth: units.size, flags: flags.length },
        remarks: "Imported settled historical meter readings for charts and forecasting without creating SOAs.",
      });
    }
    await client.query("COMMIT");
    console.log(`Historical analytics import complete: 5 months, ${units.size} units per month, ${flags.length} flagged readings.`);
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error(`Historical analytics import failed: ${error.message}`);
  process.exitCode = 1;
});
