import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import pool from '../../config/db.js';
import analyticsRoutes from '../../routes/analyticsRoutes.js';
import errorHandler from '../../middleware/errorHandler.js';

test('overview exposes read-only guidance to Admin using visible historical/live source snapshots', async () => {
  // All fixture writes are connection-local temporary tables, rolled back below.
  const client = await pool.connect(), query = client.query.bind(client);
  const originalQuery = pool.query, originalSecret = process.env.JWT_SECRET;
  let server;
  try {
    await query('BEGIN');
    await query(`CREATE TEMP TABLE users(id BIGINT,role TEXT,is_active BOOLEAN,approval_status TEXT,auth_version INTEGER) ON COMMIT DROP;
      INSERT INTO users VALUES(1,'ADMIN',TRUE,'APPROVED',0),(2,'COLLECTOR',TRUE,'APPROVED',0),(3,'RESIDENT',TRUE,'APPROVED',0);
      CREATE TEMP TABLE units(id BIGINT,unit_number TEXT,occupancy_status TEXT) ON COMMIT DROP;
      INSERT INTO units VALUES(1,'101','OCCUPIED'),(2,'102','VACANT'),(3,'103','OCCUPIED'),(4,'104','OCCUPIED'),(5,'105','OCCUPIED');
      CREATE TEMP TABLE billing_periods(id BIGINT,period_start DATE,period_end DATE,period_type TEXT,status TEXT,readings_visible_at TIMESTAMPTZ,water_rate_per_cubic_m NUMERIC) ON COMMIT DROP;
      INSERT INTO billing_periods SELECT n,make_date(2026,n+5,1),(make_date(2026,n+5,1)+INTERVAL '1 month')::date,'HISTORICAL_ANALYTICS','CLOSED',NOW(),23 FROM generate_series(1,5) n;
      INSERT INTO billing_periods VALUES(8,'2026-11-01','2026-12-01','LIVE_BILLING','DRAFT',NULL,99),(10,'2026-12-01','2027-01-01','HISTORICAL_ANALYTICS','CLOSED',NULL,99);
      CREATE TEMP TABLE meter_readings(id BIGINT,unit_id BIGINT,billing_period_id BIGINT,previous_reading NUMERIC,current_reading NUMERIC,validation_status TEXT,validation_notes TEXT) ON COMMIT DROP;
      INSERT INTO meter_readings SELECT p.id*10+u.id,u.id,p.id,0,CASE u.id WHEN 2 THEN 100 ELSE 10 END,CASE WHEN u.id=3 AND p.id=5 THEN 'FLAGGED' ELSE 'VALID' END,NULL FROM billing_periods p CROSS JOIN units u;
      CREATE TEMP TABLE billing_forecasts(id BIGINT,unit_id BIGINT,based_on_period_id BIGINT,forecast_for_month DATE,predicted_consumption NUMERIC,estimated_water_charge NUMERIC,forecast_status TEXT,status_reason TEXT,sample_count INTEGER,model_name TEXT,generated_at TIMESTAMPTZ) ON COMMIT DROP;
      INSERT INTO billing_forecasts VALUES(1,1,5,'2026-11-01',13,299,'READY',NULL,5,'LINEAR_REGRESSION',NOW()),(2,2,5,'2026-11-01',50,1150,'READY',NULL,5,'LINEAR_REGRESSION',NOW()),(3,3,5,'2026-11-01',NULL,NULL,'FLAGGED_READING',NULL,5,'LINEAR_REGRESSION',NOW()),(4,5,5,'2026-11-01',NULL,NULL,'INSUFFICIENT_DATA',NULL,2,'LINEAR_REGRESSION',NOW());`);
    const readCalls = [];
    pool.query = (sql, values) => { assert.match(sql.trim(), /^SELECT/, 'Dashboard guidance must not write or refresh data'); readCalls.push(sql); return query(sql, values); };
    process.env.JWT_SECRET = 'isolated-admin-water-guidance';
    const app = express(); app.use('/api/analytics', analyticsRoutes); app.use(errorHandler);
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/analytics/overview`;
    const request = id => fetch(url, { headers: { Authorization: `Bearer ${jwt.sign({ id, authVersion: 0 }, process.env.JWT_SECRET)}` } });
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await request(3)).status, 403);
    const response = await request(1); assert.equal(response.status, 200);
    const data = await response.json(), guidance = data.adminWaterGuidance;
    assert.ok(Array.isArray(data.chartSeries), 'Existing API fields are preserved');
    assert.equal(guidance.sourcePeriod.id, '5');
    assert.equal(guidance.sourceMonth, '2026-10-01');
    assert.equal(guidance.forecastMonth, '2026-11-01');
    assert.equal(guidance.sourcePeriod.periodType, 'HISTORICAL_ANALYTICS');
    assert.equal(guidance.coverage.totalUnits, 5);
    assert.equal(guidance.coverage.readyUnits, 2);
    assert.equal(guidance.coverage.comparableUnits, 2);
    assert.equal(guidance.coverage.missingForecastUnits, 1);
    assert.equal(guidance.coverage.insufficientHistoryUnits, 1);
    assert.equal(guidance.coverage.flaggedUnits, 1);
    assert.equal(guidance.comparison.direction, 'DECREASE');
    assert.equal(guidance.comparison.actualConsumption, 110);
    assert.equal(guidance.comparison.projectedConsumption, 63);
    assert.equal(guidance.comparison.projectedWaterCharge, 1449);
    assert.equal(guidance.inspections.unitCount, 3);
    assert.equal(guidance.inspections.highUsageUnits, 1);
    assert.equal(guidance.inspections.vacantUsageUnits, 1);
    assert.equal(guidance.inspections.flaggedReadingUnits, 1);
    assert.equal(guidance.recommendations.length, 3);
    const callsBeforeCollector = readCalls.length;
    const collector = await request(2); assert.equal(collector.status, 200);
    assert.equal(Object.hasOwn(await collector.json(), 'adminWaterGuidance'), false);
    assert.ok(!readCalls.slice(callsBeforeCollector).some(sql => sql.includes('occupancy_status')), 'Collector does not run the Admin guidance queries');

    // A newer actual period must not silently reuse the old source's forecasts.
    await query(`INSERT INTO billing_periods VALUES(9,'2026-10-05','2026-11-05','LIVE_BILLING','FORWARDED',NULL,30);
      INSERT INTO meter_readings VALUES(999,1,9,0,5,'VALID',NULL);`);
    let latest = (await (await request(1)).json()).adminWaterGuidance;
    assert.equal(latest.sourcePeriod.id, '9');
    assert.equal(latest.coverage.readyUnits, 0);
    assert.equal(latest.comparison.changePercent, null);
    await query(`INSERT INTO billing_forecasts VALUES(99,1,9,'2026-11-01',6,180,'READY',NULL,5,'LINEAR_REGRESSION',NOW());`);
    latest = (await (await request(1)).json()).adminWaterGuidance;
    assert.equal(latest.coverage.comparableUnits, 1);
    assert.equal(latest.comparison.actualConsumption, 5);
    assert.equal(latest.comparison.projectedWaterCharge, 180);
    assert.equal(latest.comparison.changePercent, 20);

    await query('DELETE FROM meter_readings');
    const empty = (await (await request(1)).json()).adminWaterGuidance;
    assert.equal(empty.status, 'NO_DATA');
    assert.equal(empty.comparison.changePercent, null);
    assert.equal(empty.coverage.totalUnits, 5);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    pool.query = originalQuery;
    if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret;
    await query('ROLLBACK'); client.release(); await pool.end();
  }
});
