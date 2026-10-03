import assert from 'node:assert/strict';
import pool from '../config/db.js';
import router from '../routes/analyticsRoutes.js';

// Integration smoke test for read handlers only. PostgreSQL enforces READ ONLY;
// no authentication token, password, or resident details are printed.
async function invoke(path, request = {}) {
  const route = router.stack.find((layer) => layer.route?.path === path)?.route;
  assert.ok(route, `Missing route ${path}`);
  let response;
  const res = { json(value) { response = value; return this; }, status() { return this; } };
  await route.stack.at(-1).handle(request, res, (error) => { throw error; });
  assert.ok(response, `Missing response from ${path}`);
  return response;
}

let client;
const originalQuery = pool.query;
try {
  client = await pool.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  pool.query = client.query.bind(client);
  const overview = await invoke('/overview');
  for (const month of overview.evaluationHistory) {
    assert.equal(month.metrics.evaluatedCount, month.baselines.lastMonth.evaluatedCount);
    assert.equal(month.metrics.evaluatedCount, month.baselines.recentAverage.evaluatedCount);
    assert.ok(month.totals.actualConsumption >= 0 && month.totals.absoluteError >= 0);
    assert.ok(month.topErrorUnits.length <= 5);
    for (const row of month.topErrorUnits) {
      assert.ok(row.absoluteError >= 0);
      assert.ok(row.errorShare >= 0 && row.errorShare <= 100);
    }
    const review = month.usageReview;
    assert.equal(review.typicalMetrics.evaluatedCount + review.alertCount, month.metrics.evaluatedCount);
    assert.equal(review.typicalMetrics.evaluatedCount, review.typicalBaselines.lastMonth.evaluatedCount);
    assert.equal(review.typicalMetrics.evaluatedCount, review.typicalBaselines.recentAverage.evaluatedCount);
    assert.equal(review.alerts.length, review.alertCount);
    assert.ok(Math.abs(review.typicalTotals.absoluteError + review.alertTotals.absoluteError - month.totals.absoluteError) < 0.002);
  }
  assert.equal(overview.evaluationType, 'RETROSPECTIVE');
  const assignment = await client.query('SELECT user_id FROM unit_assignments WHERE end_date IS NULL LIMIT 1');
  const resident = await invoke('/resident', { user: { id: assignment.rows[0]?.user_id ?? 0 } });
  assert.ok(Array.isArray(resident.units));
  const unit = await client.query('SELECT id FROM units ORDER BY id LIMIT 1');
  if (unit.rows.length) await invoke('/units/:id', { resourceId: unit.rows[0].id });
  const latest = overview.evaluationHistory.find((row) => row.forecastForMonth === overview.evaluationMonth);
  console.log(JSON.stringify({ verified: true, readOnly: true, evaluationMonth: overview.evaluationMonth,
    evaluationMonths: overview.evaluationHistory.length, metrics: overview.metrics,
    usageReview: latest ? { typicalMetrics: latest.usageReview.typicalMetrics, alertCount: latest.usageReview.alertCount,
      alertErrorShare: latest.usageReview.alertErrorShare, alerts: latest.usageReview.alerts.map((row) => ({ unitNumber: row.unitNumber, type: row.type })) } : null,
    latestForecast: overview.latestForecast, residentQueryVerified: true, unitQueryVerified: true }, null, 2));
} catch (error) {
  console.error(`Read-only analytics verification failed: ${error.code || error.message}`);
  process.exitCode = 1;
} finally {
  pool.query = originalQuery;
  if (client) await client.query('ROLLBACK').catch(() => {});
  client?.release();
  await pool.end();
}
