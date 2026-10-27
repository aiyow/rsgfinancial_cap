import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import pool from '../../config/db.js';
import routes from '../../routes/billingPeriodRoutes.js';
import errorHandler from '../../middleware/errorHandler.js';
import { billingPeriodErrors } from "../../services/billing.js";

// Every write uses a private schema; no real billing period or payment is changed.
test('draft creation and partial edits enforce rates and calendar date boundaries', async t => {
  const schema = 'codex_billing_policy_' + randomUUID().replaceAll('-', '');
  assert.match(schema, /^codex_billing_policy_[a-f0-9]{32}$/);
  const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
  if (url) url.hostname = url.hostname.replace('-pooler.', '.');
  const fixtures = new pg.Pool({ ...(url ? { connectionString: url.toString(), ssl: pool.options.ssl } : pool.options), options: `-c search_path=${schema}`, connectionTimeoutMillis: 10000, max: 5 });
  const setup = await fixtures.connect();
  const original = { query: pool.query, connect: pool.connect, secret: process.env.JWT_SECRET };
  let created = false, server;
  try {
    await setup.query(`CREATE SCHEMA "${schema}"`); created = true;
    assert.equal((await setup.query('SELECT current_schema() AS schema')).rows[0].schema, schema);
    await setup.query(`CREATE TABLE users(id BIGINT PRIMARY KEY,role TEXT,is_active BOOLEAN,approval_status TEXT,auth_version INTEGER);
      INSERT INTO users VALUES(1,'COLLECTOR',TRUE,'APPROVED',0),(2,'ADMIN',TRUE,'APPROVED',0),(3,'RESIDENT',TRUE,'APPROVED',0);
      ALTER TABLE users ADD COLUMN full_name TEXT DEFAULT 'Fixture actor';
      CREATE TABLE audit_logs(LIKE public.audit_logs INCLUDING DEFAULTS INCLUDING IDENTITY);
      CREATE TABLE billing_periods(LIKE public.billing_periods INCLUDING DEFAULTS INCLUDING IDENTITY INCLUDING GENERATED INCLUDING CONSTRAINTS);
      ALTER TABLE billing_periods ADD PRIMARY KEY(id);
      CREATE UNIQUE INDEX billing_periods_start_unique ON billing_periods(period_start);`);
    async function scoped() {
      const client = await fixtures.connect();
      assert.equal((await client.query('SELECT current_schema() AS schema')).rows[0].schema, schema);
      return client;
    }
    pool.query = async (sql, values) => { const client = await scoped(); try { return await client.query(sql, values); } finally { client.release(); } };
    pool.connect = scoped;
    process.env.JWT_SECRET = 'isolated-billing-policy-fixture';
    const app = express(); app.use(express.json()); app.use('/api/billing-periods', routes); app.use(errorHandler);
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    async function request(body, id, actor = 1) {
      const token = jwt.sign({ id: actor, authVersion: 0 }, process.env.JWT_SECRET);
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/billing-periods${id ? '/' + id : ''}`, { method: id ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    }
    const valid = { periodStart: '2026-01-31', periodEnd: '2026-02-28', dueDate: '2026-03-28', waterRatePerCubicM: 23, associationDuesRatePerSqm: 134.07, latePenaltyPercent: 0 };
    const count = async () => Number((await setup.query('SELECT COUNT(*) AS n FROM billing_periods')).rows[0].n);
    const row = async id => (await setup.query('SELECT * FROM billing_periods WHERE id=$1', [id])).rows[0];
    await t.test('invalid API requests cannot insert periods even without the browser checks', async () => {
      for (const [overrides, field] of [
        [{ waterRatePerCubicM: 0 }, 'waterRatePerCubicM'], [{ associationDuesRatePerSqm: 0 }, 'associationDuesRatePerSqm'],
        [{ waterRatePerCubicM: -1 }, 'waterRatePerCubicM'], [{ associationDuesRatePerSqm: 0.001 }, 'associationDuesRatePerSqm'],
        [{ waterRatePerCubicM: '' }, 'waterRatePerCubicM'],
        [{ periodEnd: '2025-12-31' }, 'periodEnd'], [{ periodEnd: valid.periodStart }, 'periodEnd'],
        [{ periodEnd: '2026-02-27' }, 'periodEnd'], [{ periodEnd: '2026-04-01', dueDate: '2026-04-02' }, 'periodEnd'],
        [{ dueDate: valid.periodEnd }, 'dueDate'], [{ dueDate: '2026-02-27' }, 'dueDate'], [{ dueDate: '2026-03-29' }, 'dueDate'],
        [{ periodEnd: '2026-02-29' }, 'periodEnd'], [{ dueDate: '2026-04-31' }, 'dueDate'], [{ periodStart: '0000-01-01' }, 'periodStart'],
      ]) {
        const result = await request({ ...valid, ...overrides });
        assert.equal(result.status, 400, JSON.stringify({ overrides, result }));
        assert.ok(result.data.errors.some(issue => issue.field === field), JSON.stringify(result.data));
      }
      assert.equal(await count(), 0);
      assert.equal((await request(valid, undefined, 2)).status, 403);
      assert.equal((await request(valid, undefined, 3)).status, 403);
    });
    let draft;
    await t.test('valid month-end, leap-year and year-rollover boundaries create drafts', async () => {
      for (const dates of [
        {}, { periodStart: '2028-01-31', periodEnd: '2028-02-29', dueDate: '2028-03-29' },
        { periodStart: '2026-12-31', periodEnd: '2027-01-31', dueDate: '2027-02-28' },
        { periodStart: '2026-03-31', periodEnd: '2026-05-31', dueDate: '2026-06-30' },
      ]) {
        const result = await request({ ...valid, ...dates });
        assert.equal(result.status, 201, JSON.stringify(result.data));
        assert.deepEqual(billingPeriodErrors(result.data.period), {});
        if (!draft) draft = result.data.period.id;
      }
      assert.equal(await count(), 4);
    });
    await t.test('partial edits validate the merged saved dates and reject changes atomically', async () => {
      const before = await row(draft);
      for (const body of [
        { waterRatePerCubicM: 0 }, { associationDuesRatePerSqm: 0 },
        { periodStart: '2026-03-01' }, { periodEnd: '2026-02-27' },
        { periodEnd: '2026-04-01' }, { periodEnd: '2026-03-31' },
        { dueDate: '2026-02-28' }, { dueDate: '2026-03-29' }, {},
      ]) {
        assert.equal((await request(body, draft)).status, 400, JSON.stringify(body));
        assert.deepEqual(await row(draft), before);
      }
      const updated = await request({ periodEnd: '2026-03-31', dueDate: '2026-04-01', waterRatePerCubicM: 0.01 }, draft);
      assert.equal(updated.status, 200, JSON.stringify(updated.data));
      assert.deepEqual(billingPeriodErrors(updated.data.period), {});
      await setup.query("UPDATE billing_periods SET status='GENERATED' WHERE id=$1", [draft]);
      assert.equal((await request({ waterRatePerCubicM: 25 }, draft)).status, 404);
    });
    await t.test('concurrent partial edits cannot combine into invalid saved dates', async () => {
      const result = await request({ ...valid, periodStart: '2027-04-01', periodEnd: '2027-05-01', dueDate: '2027-05-15' });
      assert.equal(result.status, 201);
      const id = result.data.period.id;
      const pair = await Promise.all([request({ periodEnd: '2027-05-10' }, id), request({ dueDate: '2027-05-05' }, id)]);
      assert.deepEqual(pair.map(result => result.status).sort(), [200, 400]);
      const stored = await row(id);
      assert.deepEqual(billingPeriodErrors({ ...valid, periodStart: stored.period_start, periodEnd: stored.period_end, dueDate: stored.due_date }), {});
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    pool.query = original.query; pool.connect = original.connect;
    if (original.secret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = original.secret;
    if (created && /^codex_billing_policy_[a-f0-9]{32}$/.test(schema)) await setup.query(`DROP SCHEMA "${schema}" CASCADE`);
    setup.release(); await fixtures.end(); await pool.end();
  }
});
