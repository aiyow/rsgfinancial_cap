import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import nodemailer from 'nodemailer';
import pool from '../../config/db.js';
import { createSoaExportRouter } from '../../routes/soaExportRoutes.js';
import {
  createProtectedSoaExportService,
  encryptSoaPdf,
  runQpdf,
  renderSoaPdf,
  loadSoaLogo,
} from "../../services/soa.js";
import authRoutes from '../../routes/authRoutes.js';
import errorHandler from '../../middleware/errorHandler.js';

// All writes use a disposable private schema and synthetic accounts. SMTP is
// intercepted. Never reads a resident statement or sends a real email.
test('protected SOA exports: real PostgreSQL transactions, HTTP access, lifecycle, quotas and safe failure handling', async t => {
  const schema = 'codex_exports_' + randomUUID().replaceAll('-', '');
  assert.match(schema, /^codex_exports_[a-f0-9]{32}$/);
  const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
  if (url) url.hostname = url.hostname.replace('-pooler.', '.');
  const db = new pg.Pool({ ...(url ? { connectionString: url.toString(), ssl: pool.options.ssl } : pool.options), options: `-c search_path=${schema}`, max: 8, connectionTimeoutMillis: 10000 });
  const setup = await db.connect();
  const original = { query: pool.query, connect: pool.connect, transport: nodemailer.createTransport, secret: process.env.JWT_SECRET };
  const envKeys = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'];
  const mailEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  let server, created = false, mailFailure = false, failReservation = false, pauseEmail, releaseEmail;
  const deliveries = [], verification = [];
  const environment = { SOA_PROTECTED_EXPORTS_ENABLED: 'true', JWT_SECRET: 'private-export-fixture' };
  try {
    await setup.query(`CREATE SCHEMA "${schema}"`); created = true;
    assert.equal((await setup.query('SELECT current_schema() AS schema')).rows[0].schema, schema);
    for (const table of ['users', 'units', 'unit_assignments', 'billing_periods', 'unit_bills', 'bill_charges', 'payment_submissions', 'payment_charge_allocations', 'payment_applications', 'payment_ledger_policy', 'soa_templates', 'soa_email_deliveries', 'audit_logs']) {
      await setup.query(`CREATE TABLE ${table}(LIKE public.${table} INCLUDING DEFAULTS INCLUDING IDENTITY INCLUDING GENERATED)`);
      const cols = (await setup.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2', [schema, table])).rows;
      for (const c of cols) if (c.column_name !== 'id') await setup.query(`ALTER TABLE ${table} ALTER COLUMN "${c.column_name}" DROP NOT NULL`);
      await setup.query(`ALTER TABLE ${table} ADD PRIMARY KEY(id)`);
    }
    await setup.query(await readFile(new URL('../../database/migrations/043_protected_soa_exports.sql', import.meta.url), 'utf8'));
    await setup.query(`INSERT INTO users(id,full_name,email,password_hash,role,is_active,approval_status,email_verified,auth_version) VALUES
      (1,'Tanjiro Kamado','resident@example.invalid','unused','RESIDENT',TRUE,'APPROVED',TRUE,0),
      (2,'Other Resident','other@example.invalid','unused','RESIDENT',TRUE,'APPROVED',TRUE,0),
      (3,'Admin Fixture','admin@example.invalid','unused','ADMIN',TRUE,'APPROVED',TRUE,0),
      (4,'Associate Fixture','associate@example.invalid','unused','COLLECTOR',TRUE,'APPROVED',TRUE,0);
      INSERT INTO units(id,unit_number,floor) VALUES(10,'234','2');
      INSERT INTO unit_assignments(id,unit_id,user_id,relationship_type,start_date,is_primary_payer) VALUES(1,10,1,'OWNER','2020-01-01',TRUE);
      INSERT INTO billing_periods(id,period_start,period_end,due_date,status,period_type) VALUES(1,'2026-10-05','2026-11-05','2026-11-10','FORWARDED','LIVE_BILLING');
      INSERT INTO unit_bills(id,unit_id,billing_period_id,unit_number_snapshot,payer_name_snapshot,payer_email_snapshot,period_start_snapshot,period_end_snapshot,statement_date,due_date_snapshot,previous_reading_snapshot,current_reading_snapshot,published_at,soa_revision,late_penalty_percent_snapshot,late_penalty_amount)
      VALUES(100,10,1,'234','José Niño de la Peña','old-snapshot@example.invalid','2026-10-05','2026-11-05','2026-10-27','2026-11-10',100,103.712,NOW(),1,0,0);
      INSERT INTO bill_charges(id,unit_bill_id,charge_type,quantity,rate_applied,description) VALUES(1,100,'WATER',3.712,23,'Water consumption'),(2,100,'ASSOCIATION_DUES',12,134.07,'Association dues');
      INSERT INTO payment_ledger_policy(id,version) VALUES(1,2);
      INSERT INTO soa_templates(id,template_data) VALUES(1,'{}');`);
    process.env.JWT_SECRET = environment.JWT_SECRET;
    for (const key of envKeys) process.env[key] = 'fixture';
    nodemailer.createTransport = () => ({ async sendMail(message) { verification.push(message); return { accepted: [message.to] }; }, close() {} });
    const scoped = {
      query: (...args) => db.query(...args),
      async connect() { const c = await db.connect(); return { async query(sql, params) { if (failReservation && sql.startsWith('INSERT INTO soa_export_rate_events')) throw new Error('Fixture reservation failure'); return c.query(sql, params); }, release: () => c.release() }; },
    };
    pool.query = (...args) => scoped.query(...args); pool.connect = () => scoped.connect();
    const service = createProtectedSoaExportService({ db: scoped, environment, checkDependencies: async () => {},
      logo: async () => process.env.QPDF_PATH ? loadSoaLogo(null) : Buffer.from('fixture-logo'),
      render: process.env.QPDF_PATH ? renderSoaPdf : async bill => Buffer.from(`%PDF plaintext fixture ${bill.totalAmount}`),
      encrypt: async (pdf, password) => { assert.match(password, /^kamado\d{4}$/); return process.env.QPDF_PATH ? encryptSoaPdf(pdf, password) : Buffer.from('%PDF encrypted synthetic artifact'); },
      mailer: { async send(delivery) { deliveries.push({ ...delivery, pdf: Buffer.from(delivery.pdf) }); if (pauseEmail) { pauseEmail(); await new Promise(resolve => { releaseEmail = resolve; }); } if (mailFailure) throw new Error('SMTP raw response with secret'); } },
    });
    const app = express(); app.use(express.json()); app.use('/api', createSoaExportRouter(service)); app.use('/api/auth', authRoutes); app.get('/api/health', (req, res) => res.json({ ok: true })); app.use((req, res) => res.status(404).json({ message: 'Not found' })); app.use(errorHandler);
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    async function request(path, { actor = 1, method = 'GET', key, body } = {}) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method,
        headers: { ...(actor ? { Authorization: `Bearer ${jwt.sign({ id: actor, authVersion: 0 }, environment.JWT_SECRET)}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = response.headers.get('content-type')?.includes('pdf') ? Buffer.from(await response.arrayBuffer()) : await response.json();
      return { status: response.status, data, headers: response.headers };
    }
    const create = (key = randomUUID(), options = {}) => request('/bills/100/protected-exports', { method: 'POST', key, ...options });
    const clearQuota = async () => {
      await setup.query('DELETE FROM soa_export_rate_events');
      await setup.query("UPDATE soa_exports SET ready_at=NOW()-INTERVAL '31 minutes' WHERE ready_at IS NOT NULL");
    };
    let first, firstKey;
    await t.test('email attachment only; duplicate clicks share preparation and one SOA email, never a portal download', async () => {
      let entered; const pending = new Promise(resolve => { entered = resolve; }); pauseEmail = entered;
      firstKey = randomUUID(); const creation = create(firstKey); await pending;
      const duplicate = await create(firstKey); assert.equal(duplicate.status, 202); assert.equal(duplicate.data.status, 'EMAIL_PENDING');
      const concurrentKey = await create();
      assert.equal(concurrentKey.status, 202); assert.equal(concurrentKey.data.exportId, duplicate.data.exportId);
      assert.equal((await request(`/soa-exports/${duplicate.data.exportId}/file`)).status, 410);
      pauseEmail = null; releaseEmail(); first = await creation;
      assert.equal(first.status, 200, JSON.stringify(first.data)); assert.equal(first.data.status, 'READY');
      assert.equal(deliveries.length, 1); assert.equal(deliveries[0].email, 'resident@example.invalid', 'Current verified account, not payer snapshot');
      assert.equal(deliveries[0].residentName, 'Tanjiro Kamado', 'Use requesting resident, not payer snapshot');
      assert.equal(deliveries[0].dueDate, '2026-11-10'); assert.equal(first.data.expiresAt, null);
      assert.match(first.data.maskedEmail, /^r\*\*\*@/); assert.ok(!JSON.stringify(first.data).includes(deliveries[0].password));
      assert.equal((await create(firstKey)).data.exportId, first.data.exportId); assert.equal(deliveries.length, 1);
      const file = await request(`/soa-exports/${first.data.exportId}/file`);
      assert.equal(file.status, 410); assert.equal(file.data.code, 'SOA_EMAIL_ONLY'); assert.equal(deliveries.length, 1);
      assert.equal(file.headers.get('content-type').includes('pdf'), false);
      if (process.env.QPDF_PATH) {
        const directory = await mkdtemp(join(tmpdir(), 'soa-http-test-')), path = join(directory, 'protected.pdf');
        try {
          await writeFile(path, deliveries[0].pdf);
          await runQpdf([`--password=${deliveries[0].password}`, '--check', path]);
          await assert.rejects(runQpdf(['--check', path]));
        } finally { await rm(directory, { recursive: true, force: true }); }
      }
      assert.equal(file.headers.get('cache-control'), 'private, no-store'); assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
      const stored = (await setup.query('SELECT * FROM soa_exports WHERE id=$1', [first.data.exportId])).rows[0];
      assert.ok(!JSON.stringify(stored).includes(deliveries[0].password)); assert.equal(stored.encrypted_pdf, null);
      assert.equal((await setup.query('SELECT COUNT(*)::int AS n FROM audit_logs')).rows[0].n, 0);
    });
    await t.test('successful email enforces a 30-minute per-SOA cooldown across new keys, refreshes and service restarts', async () => {
      const count = deliveries.length;
      const blocked = await create();
      assert.equal(blocked.status, 429); assert.equal(blocked.data.code, 'SOA_EMAIL_COOLDOWN');
      assert.ok(Number(blocked.headers.get('retry-after')) > 1700);
      assert.equal(blocked.data.nextRequestAt, first.data.nextRequestAt);
      const status = await request('/bills/100/protected-exports');
      assert.equal(status.data.status, 'READY'); assert.equal(status.data.nextRequestAt, first.data.nextRequestAt);
      assert.equal(deliveries.length, count);
      const recreated = createProtectedSoaExportService({ db: scoped, environment, checkDependencies: async () => {} });
      await assert.rejects(recreated.create(100, 1, randomUUID(), '127.0.0.1'), error => error.code === 'SOA_EMAIL_COOLDOWN');
      await setup.query("UPDATE soa_exports SET ready_at=NOW()-INTERVAL '29 minutes 50 seconds' WHERE id=$1", [first.data.exportId]);
      assert.equal((await create()).status, 429, 'Cooldown remains active just before 30 minutes');
      await setup.query("UPDATE soa_exports SET ready_at=NOW()-INTERVAL '30 minutes 1 second' WHERE id=$1", [first.data.exportId]);
      await setup.query("UPDATE soa_export_rate_events SET created_at=NOW()-INTERVAL '2 minutes'");
      assert.equal((await request('/bills/100/protected-exports')).data.status, 'AVAILABLE');
      assert.equal((await create()).data.status, 'READY'); assert.equal(deliveries.length, count + 1);
    });
    await t.test('all endpoints enforce session/role/ownership; unrelated routes and malformed/body-supplied data are safe', async () => {
      const paths = [`/soa-exports/${first.data.exportId}`, `/soa-exports/${first.data.exportId}/file`];
      for (const path of paths) {
        assert.equal((await request(path, { actor: null })).status, 401);
        for (const actor of [3, 4]) assert.equal((await request(path, { actor })).status, 403);
        assert.equal((await request(path, { actor: 2 })).status, 404);
      }
      assert.equal((await create(undefined, { actor: 2 })).status, 404);
      assert.equal((await create(undefined, { actor: null })).status, 401);
      assert.equal((await create(undefined, { actor: 3 })).status, 403);
      assert.equal((await request('/api-not-this-router', { actor: 3 })).status, 404);
      assert.equal((await request('/health', { actor: null })).status, 200);
      assert.equal((await create('invalid')).status, 400);
      assert.equal((await create(undefined, { body: { email: 'attacker@example.invalid', total: 1 } })).status, 400);
      assert.equal((await request('/bills/100/protected-exports', { actor: null })).status, 401);
      assert.equal((await request('/bills/100/protected-exports', { actor: 3 })).status, 403);
      assert.equal((await request('/bills/100/protected-exports', { actor: 2 })).status, 404);
    });
    await t.test('ended/future assignments, inactive/pending/unverified accounts, unpublished or corrected SOAs cannot release files', async () => {
      for (const [update, restore] of [
        ["UPDATE unit_assignments SET end_date=CURRENT_DATE", 'UPDATE unit_assignments SET end_date=NULL'],
        ["UPDATE unit_assignments SET start_date='2099-01-01'", "UPDATE unit_assignments SET start_date='2020-01-01'"],
        ['UPDATE users SET is_active=FALSE WHERE id=1', 'UPDATE users SET is_active=TRUE WHERE id=1'],
        ["UPDATE users SET approval_status='PENDING' WHERE id=1", "UPDATE users SET approval_status='APPROVED' WHERE id=1"],
        ['UPDATE users SET email_verified=FALSE WHERE id=1', 'UPDATE users SET email_verified=TRUE WHERE id=1'],
        ['UPDATE unit_bills SET published_at=NULL WHERE id=100', 'UPDATE unit_bills SET published_at=$1 WHERE id=100'],
        ["UPDATE billing_periods SET status='GENERATED'", "UPDATE billing_periods SET status='FORWARDED'"],
      ]) {
        const published = (await setup.query('SELECT published_at FROM unit_bills WHERE id=100')).rows[0].published_at;
        await setup.query(update); assert.notEqual((await request(`/soa-exports/${first.data.exportId}/file`)).status, 200); assert.notEqual((await create()).status, 200);
        await setup.query(restore, restore.includes('$1') ? [published] : undefined);
      }
      await setup.query('UPDATE bill_charges SET rate_applied=24 WHERE id=1');
      assert.equal((await request(`/soa-exports/${first.data.exportId}/file`)).status, 409);
      assert.equal((await setup.query('SELECT encrypted_pdf FROM soa_exports WHERE id=$1', [first.data.exportId])).rows[0].encrypted_pdf, null);
      await setup.query('UPDATE bill_charges SET rate_applied=23 WHERE id=1');
      await clearQuota(); const changedEmail = await create();
      await setup.query("UPDATE users SET email='changed@example.invalid' WHERE id=1");
      assert.equal((await request(`/soa-exports/${changedEmail.data.exportId}/file`)).status, 409);
      await setup.query("UPDATE users SET email='resident@example.invalid' WHERE id=1");
    });
    await t.test('SMTP uncertainty fails closed; idempotent retry sends nothing; a fresh request generates a surname password', async () => {
      await clearQuota(); mailFailure = true;
      const key = randomUUID(), failed = await create(key), count = deliveries.length;
      assert.equal(failed.data.status, 'FAILED'); assert.equal((await request(`/soa-exports/${failed.data.exportId}/file`)).status, 410);
      assert.equal((await create(key)).data.exportId, failed.data.exportId); assert.equal(deliveries.length, count);
      assert.equal((await setup.query('SELECT encrypted_pdf FROM soa_exports WHERE id=$1', [failed.data.exportId])).rows[0].encrypted_pdf, null);
      mailFailure = false; await clearQuota(); const fresh = await create(); assert.equal(fresh.data.status, 'READY');
      assert.match(deliveries.at(-1).password, /^kamado\d{4}$/);
    });
    await t.test('database reservations roll back atomically and cooldown/hourly user/IP limits survive service recreation', async () => {
      await clearQuota(); const before = (await setup.query('SELECT COUNT(*)::int AS n FROM soa_exports')).rows[0].n;
      failReservation = true; assert.equal((await create()).status, 503); failReservation = false;
      assert.equal((await setup.query('SELECT COUNT(*)::int AS n FROM soa_exports')).rows[0].n, before);
      const ready = await create(), key = (await setup.query('SELECT idempotency_key FROM soa_exports WHERE id=$1', [ready.data.exportId])).rows[0].idempotency_key;
      assert.equal((await create()).status, 429); assert.equal((await create(key)).data.exportId, ready.data.exportId);
      const hash = (await setup.query('SELECT ip_hash FROM soa_export_rate_events LIMIT 1')).rows[0].ip_hash;
      await clearQuota();
      await setup.query(`INSERT INTO soa_export_rate_events SELECT gen_random_uuid(),1,$1,NOW()-INTERVAL '2 minutes' FROM generate_series(1,5)`, [hash]);
      assert.equal((await create()).status, 429);
      await clearQuota(); await setup.query(`INSERT INTO soa_export_rate_events SELECT gen_random_uuid(),2,$1,NOW()-INTERVAL '2 minutes' FROM generate_series(1,20)`, [hash]);
      assert.equal((await create()).status, 429);
      const recreated = createProtectedSoaExportService({ db: scoped, environment, checkDependencies: async () => {} });
      await assert.rejects(recreated.create(100, 1, randomUUID(), '127.0.0.1'), error => error.status === 429);
    });
    await t.test('expiration purges bytes, interrupted exports fail, metadata retention and deleted SOAs fail closed', async () => {
      await clearQuota(); const ready = await create();
      await service.cleanup();
      assert.equal((await request(`/soa-exports/${ready.data.exportId}`)).data.status, 'READY', 'New email receipts have no retrieval deadline');
      await setup.query("UPDATE soa_exports SET encrypted_pdf=$2,expires_at=NOW()+INTERVAL '15 minutes' WHERE id=$1", [ready.data.exportId, Buffer.from('legacy encrypted artifact')]);
      await service.cleanup();
      const legacy = (await setup.query('SELECT status,encrypted_pdf FROM soa_exports WHERE id=$1', [ready.data.exportId])).rows[0];
      assert.equal(legacy.status, 'EXPIRED'); assert.equal(legacy.encrypted_pdf, null, 'Legacy portal artifacts must be removed even before the old download deadline');
      await setup.query("UPDATE soa_exports SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [ready.data.exportId]);
      assert.equal((await request(`/soa-exports/${ready.data.exportId}`)).data.status, 'EXPIRED');
      assert.equal((await request(`/soa-exports/${ready.data.exportId}/file`)).status, 410);
      await setup.query("UPDATE soa_exports SET status='EMAIL_PENDING',created_at=NOW()-INTERVAL '6 minutes',expires_at=NULL WHERE id=$1", [ready.data.exportId]);
      await service.cleanup();
      const stale = (await setup.query('SELECT status,encrypted_pdf FROM soa_exports WHERE id=$1', [ready.data.exportId])).rows[0]; assert.equal(stale.status, 'FAILED'); assert.equal(stale.encrypted_pdf, null);
      await setup.query("UPDATE soa_exports SET created_at=NOW()-INTERVAL '31 days' WHERE id=$1", [ready.data.exportId]); await service.cleanup();
      assert.equal((await request(`/soa-exports/${ready.data.exportId}`)).status, 404);
      await clearQuota(); const deleted = await create(); await setup.query('DELETE FROM unit_bills WHERE id=100');
      assert.equal((await request(`/soa-exports/${deleted.data.exportId}/file`)).status, 404);
    });
    await t.test('legacy approved unverified residents receive the existing verification link without resetting approval', async () => {
      await setup.query("UPDATE users SET email_verified=FALSE,email_verification_last_sent_at=NULL WHERE id=1");
      const sent = await request('/auth/resend-verification', { actor: null, method: 'POST', body: { email: 'resident@example.invalid' } });
      assert.equal(sent.status, 200); assert.equal(verification.length, 1); assert.match(sent.data.message, /remains approved/);
      const token = verification[0].text.match(/verify-email\?token=([^\s]+)/)[1];
      const verified = await request(`/auth/verify-email?token=${token}`, { actor: null });
      assert.equal(verified.status, 200, JSON.stringify(verified.data)); assert.equal(verified.data.user.approvalStatus, 'APPROVED'); assert.equal(verified.data.user.emailVerified, true);
    });
    await t.test('feature off or missing preflight never renders or releases a PDF', async () => {
      environment.SOA_PROTECTED_EXPORTS_ENABLED = 'false'; assert.equal((await create()).status, 503);
      assert.equal((await request(`/soa-exports/${first.data.exportId}/file`)).status, 503);
      const missing = createProtectedSoaExportService({ db: scoped, environment: { SOA_PROTECTED_EXPORTS_ENABLED: 'true' }, checkDependencies: async () => { throw new Error('missing deployment prerequisite'); } });
      await assert.rejects(missing.ensureReady(), error => error.status === 503 && !error.message.includes('prerequisite'));
    });
  } finally {
    if (releaseEmail) releaseEmail();
    if (server) await new Promise(resolve => server.close(resolve));
    pool.query = original.query; pool.connect = original.connect; nodemailer.createTransport = original.transport;
    if (original.secret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = original.secret;
    for (const key of envKeys) { if (mailEnv[key] === undefined) delete process.env[key]; else process.env[key] = mailEnv[key]; }
    if (created) await setup.query(`DROP SCHEMA "${schema}" CASCADE`);
    setup.release(); await db.end(); await pool.end();
  }
});
