import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import pool from '../../backend/config/db.js';
import { refreshAnalyticsForecasts } from '../../backend/services/refreshAnalyticsForecasts.js';
import { buildForecast, regenerateForecasts } from '../../backend/services/predictiveAnalytics.js';
import { regeneratePrescriptiveRecommendations } from '../../backend/services/prescriptiveAnalytics.js';

if (!process.argv.includes('--activate')) throw new Error('Explicit --activate required to refresh saved derived analytics.');
const dataset = JSON.parse(await readFile(new URL('dataset.json',import.meta.url),'utf8'));
const protectedTables = ['billing_periods','meter_readings','unit_bills','payment_submissions','payment_applications','payment_charge_allocations','units'];
const fingerprintSql = protectedTables.map(table => `SELECT '${table}' AS name, COUNT(*)::int AS count,
  md5(COALESCE(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), '')) AS hash FROM ${table} t`).join(' UNION ALL ');
let before;
let after;
let verifiedForecasts = 0;
try {
  const result = await refreshAnalyticsForecasts(pool, {
    generate: async (client,id) => {
      if (!before) before = (await client.query(fingerprintSql)).rows;
      await regenerateForecasts(client,id);
      console.log(`Rebuilt forecasts for period ${id}`);
    },
    recommend: async client => {
      await regeneratePrescriptiveRecommendations(client);
      const saved = await client.query(`SELECT unit_id AS "unitId", based_on_period_id AS "periodId",
        model_name AS "modelName", forecast_status AS status, status_reason AS reason,
        predicted_consumption AS prediction, estimated_water_charge AS charge, sample_count AS samples
        FROM billing_forecasts WHERE based_on_period_id=ANY($1::bigint[])`, [dataset.periods.map(row=>row.id)]);
      assert.equal(saved.rows.length,dataset.units.length*dataset.periods.length);
      for (const row of saved.rows) {
        const period = dataset.periods.find(period=>String(period.id)===String(row.periodId));
        const expected = buildForecast(dataset.readings.filter(reading=>String(reading.unitId)===String(row.unitId)),
          {sourceMonth:period.periodStart,waterRate:period.waterRate});
        assert.equal(row.status,expected.status);
        assert.equal(row.reason,expected.reason);
        assert.equal(row.modelName,expected.modelName || 'LINEAR_REGRESSION');
        assert.equal(row.prediction===null?null:Number(row.prediction),expected.predictedConsumption ?? null);
        assert.equal(row.charge===null?null:Number(row.charge),expected.estimatedWaterCharge ?? null);
        assert.equal(row.samples,expected.sampleCount);
      }
      verifiedForecasts=saved.rows.length;
      after=(await client.query(fingerprintSql)).rows;
      assert.deepEqual(after,before,'Protected source/billing/payment tables changed; rollback required.');
      console.log('Verified every saved forecast and unchanged protected tables before commit.');
    },
  });
  const report={committedAt:new Date().toISOString(),...result,verifiedForecasts,sourceTablesUnchanged:true,protectedTables:after};
  await writeFile(new URL('activation.json',import.meta.url),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} catch (error) {
  console.error(`Activation failed: ${error.code || error.message}`);
  process.exitCode=1;
} finally {await pool.end();}
