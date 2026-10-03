import { mkdir, readFile, writeFile } from 'node:fs/promises';
import pool from '../config/db.js';
import { analyticsPeriodCondition } from '../services/analyticsPeriods.js';
import { buildForecast } from '../services/predictiveAnalytics.js';
import { benchmarkDataset } from '../services/forecastEvaluation.js';

// Only SELECT queries run against the database. Generated JSON is local evidence.
async function capture() {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const periods = await client.query(`SELECT p.id, p.period_start AS "periodStart",
      p.water_rate_per_cubic_m AS "waterRate" FROM billing_periods p
      WHERE ${analyticsPeriodCondition('p')} ORDER BY p.period_start`);
    const readings = await client.query(`SELECT m.unit_id AS "unitId", u.unit_number AS "unitNumber",
      p.period_start AS "periodStart", m.current_reading - m.previous_reading AS consumption,
      m.validation_status AS "validationStatus" FROM meter_readings m
      JOIN units u ON u.id = m.unit_id JOIN billing_periods p ON p.id = m.billing_period_id
      WHERE ${analyticsPeriodCondition('p')} ORDER BY m.unit_id, p.period_start`);
    const units = await client.query('SELECT id AS "unitId", unit_number AS "unitNumber" FROM units ORDER BY id');
    const forecasts = await client.query(`SELECT f.unit_id AS "unitId", f.based_on_period_id AS "basedOnPeriodId",
      f.forecast_for_month AS "forecastForMonth", f.predicted_consumption AS "predictedConsumption",
      f.model_name AS "modelName", f.sample_count AS "sampleCount", f.forecast_status AS status
      FROM billing_forecasts f JOIN billing_periods p ON p.id = f.based_on_period_id
      WHERE ${analyticsPeriodCondition('p')} ORDER BY f.forecast_for_month, f.unit_id`);
    await client.query('COMMIT');
    const baseline = periods.rows.flatMap((period) => units.rows.map((unit) => ({
      unitId: unit.unitId, basedOnPeriodId: period.id,
      ...buildForecast(readings.rows.filter((row) => Number(row.unitId) === Number(unit.unitId)
        && row.periodStart <= period.periodStart), { waterRate: period.waterRate, policy: 'legacy', sourceMonth: period.periodStart }),
    })));
    const outputDir = new URL('../../artifacts/', import.meta.url);
    await mkdir(outputDir, { recursive: true });
    await writeFile(new URL(process.argv.includes('--updated') ? 'forecast-connected-dataset.json' : 'forecast-dataset.json', outputDir), JSON.stringify({
      capturedAt: new Date().toISOString(), periods: periods.rows, readings: readings.rows,
      units: units.rows, savedForecasts: forecasts.rows, baseline,
    }, null, 2));
    console.log(JSON.stringify({ captured: true, months: periods.rows.map((p) => p.periodStart),
      units: units.rowCount, readings: readings.rowCount, savedForecasts: forecasts.rowCount }));
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error(`Cannot capture connected history: ${error.code || error.name}. No database changes were made.`);
    process.exitCode = 1;
  } finally {
    client?.release();
    await pool.end();
  }
}

if (process.argv.includes('--compare')) {
  try {
    const outputDir = new URL('../../artifacts/', import.meta.url);
    const dataset = JSON.parse(await readFile(new URL('forecast-dataset.json', outputDir), 'utf8'));
    const report = benchmarkDataset(dataset);
    await writeFile(new URL('forecast-benchmark.json', outputDir), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ aggregate: report.aggregate, latest: report.latest, acceptance: report.acceptance }, null, 2));
  } finally { await pool.end(); }
} else {
  await capture();
}
