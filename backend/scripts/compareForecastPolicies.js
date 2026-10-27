import { mkdir, writeFile } from 'node:fs/promises';
import pool from '../config/db.js';
import { analyticsPeriodCondition, compareForecastPolicies } from "../services/analytics.js";

// Connected-history capture is strictly read-only; only the report is written locally.
const client = await pool.connect();
try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const periods = await client.query(`SELECT p.id, p.period_start AS "periodStart",
    p.water_rate_per_cubic_m AS "waterRate" FROM billing_periods p
    WHERE ${analyticsPeriodCondition('p')} ORDER BY p.period_start`);
  const units = await client.query('SELECT id AS "unitId", unit_number AS "unitNumber" FROM units ORDER BY id');
  const readings = await client.query(`SELECT m.unit_id AS "unitId", p.period_start AS "periodStart",
    m.current_reading - m.previous_reading AS consumption, m.validation_status AS "validationStatus"
    FROM meter_readings m JOIN billing_periods p ON p.id = m.billing_period_id
    WHERE ${analyticsPeriodCondition('p')} ORDER BY m.unit_id, p.period_start`);
  await client.query('COMMIT');
  const dataset = { capturedAt: new Date().toISOString(), periods: periods.rows, units: units.rows, readings: readings.rows };
  const report = compareForecastPolicies(dataset);
  const output = new URL('../../artifacts/regression-first/', import.meta.url);
  await mkdir(output, { recursive: true });
  await writeFile(new URL('dataset.json', output), JSON.stringify(dataset, null, 2));
  await writeFile(new URL('comparison.json', output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ evaluatedCount: report.evaluatedCount, eligibilityMismatchCount: report.eligibilityMismatchCount,
    aggregate: report.aggregate, latest: report.latest, monthly: report.monthly }, null, 2));
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`Policy comparison failed: ${error.code || error.name}`);
  process.exitCode = 1;
} finally { client.release(); await pool.end(); }
