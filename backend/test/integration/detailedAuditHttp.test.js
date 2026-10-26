import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import pool from '../../config/db.js';
import auditRoutes from '../../routes/auditLogRoutes.js';
import unitRoutes from '../../routes/unitRoutes.js';
import periodRoutes from '../../routes/billingPeriodRoutes.js';
import errorHandler from '../../middleware/errorHandler.js';
import { writeAuditLog } from '../../services/auditLog.js';

// Only disposable private-schema rows are read or changed by this test.
test('audit API preserves snapshots, redacts secrets, pages all history and commits with mutations', async t => {
  const schema = 'codex_audit_' + randomUUID().replaceAll('-', '');
  assert.match(schema, /^codex_audit_[a-f0-9]{32}$/);
  const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
  if (url) url.hostname = url.hostname.replace('-pooler.', '.');
  const fixtures = new pg.Pool({ ...(url ? { connectionString: url.toString(), ssl: pool.options.ssl } : pool.options), options: `-c search_path=${schema}`, connectionTimeoutMillis: 10000, max: 6 });
  const setup = await fixtures.connect();
  const original = { query: pool.query, connect: pool.connect, secret: process.env.JWT_SECRET };
  let server, created = false, failAudit = false;
  try {
    await setup.query(`CREATE SCHEMA "${schema}"`); created = true;
    assert.equal((await setup.query('SELECT current_schema() AS schema')).rows[0].schema, schema);
    await setup.query(`CREATE TABLE users(id BIGINT PRIMARY KEY,full_name TEXT,email TEXT,role TEXT,is_active BOOLEAN DEFAULT TRUE,approval_status TEXT DEFAULT 'APPROVED',auth_version INTEGER DEFAULT 0);
      INSERT INTO users(id,full_name,email,role) VALUES(1,'Original Admin','admin@example.invalid','ADMIN'),(2,'Other Admin','other@example.invalid','ADMIN'),(3,'Collector','collector@example.invalid','COLLECTOR'),(4,'Resident','resident@example.invalid','RESIDENT');
      CREATE TABLE audit_logs(LIKE public.audit_logs INCLUDING DEFAULTS INCLUDING IDENTITY INCLUDING GENERATED INCLUDING CONSTRAINTS);
      CREATE TABLE units(LIKE public.units INCLUDING DEFAULTS INCLUDING IDENTITY INCLUDING GENERATED);
      CREATE TABLE unit_assignments(unit_id BIGINT,end_date DATE);
      CREATE TABLE billing_periods(LIKE public.billing_periods INCLUDING DEFAULTS INCLUDING IDENTITY INCLUDING GENERATED INCLUDING CONSTRAINTS);
      INSERT INTO audit_logs(actor_user_id,actor_name_snapshot,actor_role_snapshot,entity_name,entity_id,action,old_values,created_at)
      SELECT 1,'Original Admin','ADMIN','BILLING_PERIOD',n,'DELETED',jsonb_build_object('periodStart','2026-10-05','periodEnd','2026-11-05','billCount',173,'passwordHash','private-credential'),'2026-10-25 16:00:00Z'::timestamptz
      FROM generate_series(1,235) n;`);
    async function scoped() {
      const client = await fixtures.connect();
      assert.equal((await client.query('SELECT current_schema() AS schema')).rows[0].schema, schema);
      return { query(sql, values) { if (failAudit && sql.includes('INSERT INTO audit_logs')) throw Object.assign(new Error('Simulated audit failure'), { status: 503 }); return client.query(sql, values); }, release() { client.release(); } };
    }
    pool.connect = scoped;
    pool.query = async (sql, values) => { const client = await scoped(); try { return await client.query(sql, values); } finally { client.release(); } };
    process.env.JWT_SECRET = 'private-audit-fixture';
    const app = express(); app.use(express.json()); app.use('/api/audit-logs', auditRoutes); app.use('/api/units', unitRoutes); app.use('/api/billing-periods', periodRoutes); app.use(errorHandler);
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    async function request(path, { actor = 2, method = 'GET', body } = {}) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(actor ? { Authorization: `Bearer ${jwt.sign({ id: actor, authVersion: 0 }, process.env.JWT_SECRET)}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, data: await response.json() };
    }
    const auditCount = async () => Number((await setup.query('SELECT COUNT(*) AS n FROM audit_logs')).rows[0].n);
    await t.test('pagination reaches beyond 200 with stable order, complete totals and light list rows', async () => {
      const first = await request('/api/audit-logs'); assert.equal(first.status, 200, JSON.stringify(first.data));
      assert.equal(first.data.pagination.total, 235); assert.equal(first.data.logs.length, 10);
      assert.equal(Number(first.data.logs[0].id), 235); assert.equal(first.data.summary.admin, 235);
      assert.equal(first.data.logs[0].oldValues, undefined); assert.equal(first.data.logs[0].context.affectedRecords, undefined);
      const last = await request('/api/audit-logs?page=24'); assert.equal(last.data.logs.length, 5); assert.equal(Number(last.data.logs.at(-1).id), 1);
      assert.equal((await request('/api/audit-logs?page=999')).data.pagination.page, 24);
      for (const suffix of ['?page=-1', '?pageSize=200', '?from=2026-02-30', '?from=2026-11-01&to=2026-10-01']) assert.equal((await request('/api/audit-logs' + suffix)).status, 400);
    });
    await t.test('legacy deleted batches remain specific and secrets never reach detail or search', async () => {
      const detail = await request('/api/audit-logs/1'); assert.equal(detail.status, 200);
      assert.equal(detail.data.log.context.target.entityId, '1'); assert.equal(detail.data.log.context.target.periodStart, '2026-10-05');
      assert.equal(detail.data.log.context.counts.billCount, 173); assert.ok(!JSON.stringify(detail.data).includes('private-credential'));
      assert.equal((await request('/api/audit-logs?q=private-credential')).data.pagination.total, 0);
      assert.equal((await request('/api/audit-logs?q=2026-10-05&entity=BILLING_PERIOD&action=DELETE&actorRole=ADMIN&from=2026-10-26&to=2026-10-26')).data.pagination.total, 235);
      assert.equal((await request('/api/audit-logs?from=2026-10-25&to=2026-10-25')).data.pagination.total, 0);
      assert.equal((await request('/api/audit-logs/999999')).status, 404);
    });
    await t.test('historical users survive rename and deletion while automatic/unknown entries are excluded', async () => {
      await setup.query("UPDATE users SET full_name='Renamed Actor',role='RESIDENT' WHERE id=1");
      assert.equal((await request('/api/audit-logs/1')).data.log.actorName, 'Original Admin');
      assert.equal((await request('/api/audit-logs/1')).data.log.actorRole, 'ADMIN');
      await setup.query('UPDATE audit_logs SET actor_user_id=NULL WHERE actor_user_id=1'); await setup.query('DELETE FROM users WHERE id=1');
      assert.equal((await request('/api/audit-logs/1')).data.log.actorName, 'Original Admin');
      const before = await auditCount();
      assert.equal(await writeAuditLog({ client: setup, entityName: 'ANALYTICS', action: 'REFRESH_FORECASTS', newValues: { periodCount: 2 } }), false);
      assert.equal(await auditCount(), before);
      const hidden = (await setup.query("INSERT INTO audit_logs(entity_name,action,context) VALUES('ANALYTICS','REFRESH_FORECASTS','{\"origin\":\"SYSTEM\"}'),('UNIT','UPDATE','{}'),('UNIT_BILL','ASSOCIATION_PENALTY_RECALCULATED','{}') RETURNING id")).rows;
      const result = await request('/api/audit-logs');
      assert.equal(result.data.summary.total, before);
      assert.equal(result.data.summary.system, undefined); assert.equal(result.data.summary.unknown, undefined);
      assert.ok(!result.data.filters.entities.includes('ANALYTICS'));
      for (const entry of hidden) assert.equal((await request('/api/audit-logs/' + entry.id)).status, 404);
      assert.equal(Object.entries(result.data.summary).filter(([key]) => key !== 'total').reduce((sum, [, count]) => sum + count, 0), result.data.summary.total);
      assert.equal((await request('/api/audit-logs?actorRole=SYSTEM')).status, 400);
      assert.equal(await auditCount(), before + 3, 'Historical system/unknown entries are retained in storage');
    });
    await t.test('Admin-only authorization applies to list and details', async () => {
      for (const path of ['/api/audit-logs', '/api/audit-logs/1']) {
        assert.equal((await request(path, { actor: null })).status, 401);
        for (const actor of [3, 4]) assert.equal((await request(path, { actor })).status, 403);
      }
    });
    await t.test('unit changes and draft creation roll back on audit failure and no-op edits add no history', async () => {
      const before = await auditCount(), body = { unitNumber: 'Fixture 232', floor: '2', billableAreaSqm: 12, occupancyStatus: 'VACANT' };
      failAudit = true;
      const failed = await request('/api/units', { method: 'POST', body }); assert.equal(failed.status, 503, JSON.stringify(failed.data));
      assert.equal(Number((await setup.query('SELECT COUNT(*) AS n FROM units')).rows[0].n), 0); assert.equal(await auditCount(), before);
      const period = { periodStart: '2026-01-31', periodEnd: '2026-02-28', dueDate: '2026-03-15', waterRatePerCubicM: 23, associationDuesRatePerSqm: 134.07 };
      assert.equal((await request('/api/billing-periods', { method: 'POST', actor: 3, body: period })).status, 503);
      assert.equal(Number((await setup.query('SELECT COUNT(*) AS n FROM billing_periods')).rows[0].n), 0);
      failAudit = false;
      const createdUnit = await request('/api/units', { method: 'POST', body }); assert.equal(createdUnit.status, 201, JSON.stringify(createdUnit.data));
      const id = createdUnit.data.unit.id;
      assert.equal(await auditCount(), before + 1);
      assert.equal((await request('/api/units/' + id, { method: 'PATCH', body: { unitNumber: body.unitNumber } })).status, 200);
      assert.equal(await auditCount(), before + 1);
      failAudit = true;
      assert.equal((await request('/api/units/' + id, { method: 'PATCH', body: { unitNumber: 'Changed' } })).status, 503);
      assert.equal((await setup.query('SELECT unit_number FROM units WHERE id=$1', [id])).rows[0].unit_number, body.unitNumber);
      failAudit = false;
    });
    await t.test('grouped details retain affected records and before/after values after source deletion', async () => {
      await writeAuditLog({ client: setup, actorUserId: 2, entityName: 'BILLING_PERIOD', entityId: 42, action: 'DELETED', oldValues: { periodStart: '2026-10-05', periodEnd: '2026-11-05' }, context: { affectedRecords: [{ unitNumber: '232', before: { previousReading: 12, currentReading: 15 }, after: null }] } });
      const latest = (await request('/api/audit-logs')).data.logs[0];
      assert.equal(latest.context.affectedCount, 1); assert.equal(latest.context.affectedRecords, undefined);
      const detail = (await request('/api/audit-logs/' + latest.id)).data.log;
      assert.equal(detail.context.affectedRecords[0].before.currentReading, 15); assert.equal(detail.context.affectedRecords[0].after, null);
    });
  } finally {
    failAudit = false;
    if (server) await new Promise(resolve => server.close(resolve)); pool.query = original.query; pool.connect = original.connect;
    if (original.secret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = original.secret;
    if (created && /^codex_audit_[a-f0-9]{32}$/.test(schema)) await setup.query(`DROP SCHEMA "${schema}" CASCADE`);
    setup.release(); await fixtures.end(); await pool.end();
  }
});
