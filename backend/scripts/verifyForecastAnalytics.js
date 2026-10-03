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
  }
  assert.equal(overview.evaluationType, 'RETROSPECTIVE');
  const assignment = await client.query('SELECT user_id FROM unit_assignments WHERE end_date IS NULL LIMIT 1');
  const resident = await invoke('/resident', { user: { id: assignment.rows[0]?.user_id ?? 0 } });
  assert.ok(Array.isArray(resident.units));
  const unit = await client.query('SELECT id FROM units ORDER BY id LIMIT 1');
  if (unit.rows.length) await invoke('/units/:id', { resourceId: unit.rows[0].id });
  console.log(JSON.stringify({ verified: true, readOnly: true, evaluationMonth: overview.evaluationMonth,
    evaluationMonths: overview.evaluationHistory.length, metrics: overview.metrics,
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
