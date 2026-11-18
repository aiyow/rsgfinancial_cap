import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { once } from 'node:events';
import { PGlite } from '@electric-sql/pglite';
import express from 'express';
import jwt from 'jsonwebtoken';
import ExcelJS from 'exceljs';
import pool from '../../config/db.js';
import unitRoutes from '../../routes/unitRoutes.js';
import periodRoutes from '../../routes/billingPeriodRoutes.js';
import reportRoutes from '../../routes/financialReportRoutes.js';
import errorHandler from '../../middleware/errorHandler.js';
import { billSelect, groupBy } from '../../services/billing.js';

// In-memory PostgreSQL: no live database, email, or resident data is touched.
test('Admin SOA names are independent templates and generation preserves historical snapshots', { timeout: 180000 }, async t => {
  const db = new PGlite();
  const original = { query: pool.query, connect: pool.connect, secret: process.env.JWT_SECRET };
  let server, failAudit = false;
  try {
    await db.exec(await readFile(new URL('../../database/schema.sql', import.meta.url), 'utf8'));
    const directory = new URL('../../database/migrations/', import.meta.url);
    for (const file of (await readdir(directory)).filter(f => /^\d{3}_.+\.sql$/.test(f) && !f.startsWith('046_')).sort()) {
      await db.exec(await readFile(new URL(file, directory), 'utf8'));
    }
    await db.exec(`INSERT INTO users(id,full_name,email,password_hash,role,is_active,approval_status,auth_version) VALUES
      (1,'Fixture Admin','admin@example.invalid','fixture','ADMIN',TRUE,'APPROVED',0),
      (2,'Original Resident','resident@example.invalid','fixture','RESIDENT',TRUE,'APPROVED',0),
      (3,'Fixture Associate','associate@example.invalid','fixture','COLLECTOR',TRUE,'APPROVED',0),
      (4,'Other Tenant','other@example.invalid','fixture','RESIDENT',TRUE,'APPROVED',0);
      INSERT INTO units(id,unit_number,floor,billable_area_sqm,occupancy_status) VALUES
        (10,'231','2',30,'OCCUPIED'),(11,'232','2',30,'VACANT');
      INSERT INTO unit_assignments(unit_id,user_id,relationship_type,start_date,is_primary_payer) VALUES
        (10,4,'TENANT','2020-01-01',FALSE),(10,2,'OWNER','2020-01-01',TRUE);
      INSERT INTO billing_periods(id,period_start,period_end,due_date,water_rate_per_cubic_m,association_dues_rate_per_sqm,created_by)
        VALUES(1,'2026-10-01','2026-11-01','2099-01-01',10,10,3),
        (2,'2026-11-01','2026-12-01','2099-02-01',10,10,3),
        (3,'2026-12-01','2027-01-01','2099-03-01',10,10,3);
      INSERT INTO unit_bills(id,unit_id,billing_period_id,generated_by,unit_number_snapshot,payer_name_snapshot,
        period_start_snapshot,period_end_snapshot,statement_date,due_date_snapshot)
        VALUES(100,10,1,3,'231','Historical Name','2026-10-01','2026-11-01','2026-11-01','2099-01-01');
      SELECT setval(pg_get_serial_sequence('unit_bills','id'),100);`);
    const migration = await readFile(new URL('046_unit_soa_resident_names.sql', directory), 'utf8');
    await db.exec(migration);
    pool.query = async (sql, values) => {
      if (/INSERT INTO audit_logs/.test(sql) && (failAudit === true || failAudit === values?.[2])) throw new Error('Fixture audit failure');
      return db.query(sql, values);
    };
    pool.connect = async () => ({ query: pool.query, release() {} });
    process.env.JWT_SECRET = 'unit-soa-name-isolated-fixture';
    const app = express(); app.use(express.json());
    app.use('/api/units', unitRoutes); app.use('/api/billing-periods', periodRoutes); app.use('/api/reports', reportRoutes); app.use(errorHandler);
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    async function request(path, { actor = 1, method = 'GET', body } = {}) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method,
        headers: { ...(actor ? { Authorization: `Bearer ${jwt.sign({ id: actor, authVersion: 0 }, process.env.JWT_SECRET)}` } : {}), 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      if (path.includes('/export') && response.ok) return { status: response.status, buffer: Buffer.from(await response.arrayBuffer()) };
      return { status: response.status, data: await response.json() };
    }
    const save = (name, options = {}) => request('/units/10/soa-name', { method: 'PATCH', body: { soaResidentName: name }, ...options });

    await t.test('one-time copy uses the current primary payer and never resynchronizes account names', async () => {
      assert.equal((await db.query('SELECT soa_resident_name FROM units WHERE id=10')).rows[0].soa_resident_name, 'Original Resident');
      await db.exec("UPDATE users SET full_name='Renamed Account' WHERE id=2");
      await db.exec(migration);
      assert.equal((await db.query('SELECT soa_resident_name FROM units WHERE id=10')).rows[0].soa_resident_name, 'Original Resident');
      assert.equal((await db.query('SELECT soa_resident_name FROM units WHERE id=11')).rows[0].soa_resident_name, null);
    });
    await t.test('authorization, validation and immutable directory fields', async () => {
      for (const actor of [null, 2, 3, 4]) assert.equal((await save('Denied', { actor })).status, actor ? 403 : 401);
      for (const value of ['', '   ', 'a'.repeat(206), 'Line\nBreak']) assert.equal((await save(value)).status, 400);
      assert.equal((await save('Invalid', { body: { soaResidentName: 'Invalid', floor: '99' } })).status, 400);
      assert.equal((await request('/units/999/soa-name', { method: 'PATCH', body: { soaResidentName: 'Unknown' } })).status, 404);
      const saved = await save('  José Dela Cruz / Family  ');
      assert.equal(saved.status, 200, JSON.stringify(saved.data));
      assert.equal(saved.data.unit.soaResidentName, 'José Dela Cruz / Family');
      const unit = (await db.query('SELECT unit_number,floor,billable_area_sqm,occupancy_status FROM units WHERE id=10')).rows[0];
      assert.deepEqual(unit, { unit_number: '231', floor: '2', billable_area_sqm: '30.00', occupancy_status: 'OCCUPIED' });
      assert.equal((await db.query('SELECT full_name FROM users WHERE id=2')).rows[0].full_name, 'Renamed Account');
      assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM unit_assignments')).rows[0].count, 2);
      const log = (await db.query("SELECT old_values,new_values FROM audit_logs WHERE entity_name='UNIT' AND entity_id=10 ORDER BY id DESC LIMIT 1")).rows[0];
      assert.equal(log.old_values.soaResidentName, 'Original Resident');
      assert.equal(log.new_values.soaResidentName, 'José Dela Cruz / Family');
    });
    await t.test('audit failure rolls back the name and migration reruns preserve Admin edits', async () => {
      failAudit = true; assert.equal((await save('Must Roll Back')).status, 500); failAudit = false;
      await db.exec(migration);
      assert.equal((await db.query('SELECT soa_resident_name FROM units WHERE id=10')).rows[0].soa_resident_name, 'José Dela Cruz / Family');
    });
    await t.test('report and Excel display the saved template for both staff roles', async () => {
      for (const actor of [1, 3]) {
        const result = await request('/reports/financial?month=2026-11', { actor });
        assert.equal(result.status, 200, JSON.stringify(result.data));
        assert.equal(result.data.occupancy.rows.find(r => r.unitId === 10).soaResidentName, 'José Dela Cruz / Family');
      }
      const exported = await request('/reports/financial/export?month=2026-11&tab=occupancy');
      assert.equal(exported.status, 200, JSON.stringify(exported.data));
      const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(exported.buffer);
      const values = workbook.getWorksheet('Unit Occupancy').getSheetValues().flatMap(row => row || []);
      assert.ok(values.includes('Resident Name')); assert.ok(values.includes('José Dela Cruz / Family'));
      assert.ok(!values.includes('Renamed Account'));
    });
    await t.test('real bill generation snapshots the template and keeps recipient account/email separate', async () => {
      const generated = await request('/billing-periods/2/generate', { actor: 3, method: 'POST' });
      assert.equal(generated.status, 200, JSON.stringify(generated.data));
      const bill = (await db.query('SELECT id,payer_name_snapshot,payer_email_snapshot FROM unit_bills WHERE unit_id=10 AND billing_period_id=2')).rows[0];
      assert.equal(bill.payer_name_snapshot, 'José Dela Cruz / Family');
      assert.equal(bill.payer_email_snapshot, 'resident@example.invalid');
      const displayed = await db.query(`${billSelect} WHERE b.id=$1 ${groupBy}`, [bill.id]);
      assert.equal(displayed.rows[0].payerName, 'José Dela Cruz / Family');
      assert.equal((await save('Next Statement Name')).status, 200);
      assert.equal((await db.query('SELECT payer_name_snapshot FROM unit_bills WHERE id=100')).rows[0].payer_name_snapshot, 'Historical Name');
      assert.equal((await db.query('SELECT payer_name_snapshot FROM unit_bills WHERE id=$1', [bill.id])).rows[0].payer_name_snapshot, 'José Dela Cruz / Family');
      assert.equal((await request('/billing-periods/3/generate', { actor: 3, method: 'POST' })).status, 200);
      assert.equal((await db.query('SELECT payer_name_snapshot FROM unit_bills WHERE unit_id=10 AND billing_period_id=3')).rows[0].payer_name_snapshot, 'Next Statement Name');
      // An unassigned unit must never silently pick up a later account name.
      assert.equal((await db.query('SELECT payer_name_snapshot FROM unit_bills WHERE unit_id=11 AND billing_period_id=3')).rows[0].payer_name_snapshot, null);
    });
    await t.test('bulk edits validate all names, require Admin and commit or roll back the complete set', async () => {
      const body = { names: [{ unitId: 11, soaResidentName: ' Second Family ' }, { unitId: 10, soaResidentName: 'First Family' }] };
      const bulk = (data = body, actor = 1) => request('/units/soa-names', { actor, method: 'PATCH', body: data });
      for (const actor of [null, 2, 3, 4]) assert.equal((await bulk(body, actor)).status, actor ? 403 : 401);
      for (const data of [
        { names: [] }, { names: [body.names[0], body.names[0]] },
        { names: [{ unitId: 10, soaResidentName: ' ' }] },
        { names: [{ unitId: 10, soaResidentName: 'x', floor: '99' }] },
        { names: [{ unitId: 10, soaResidentName: 'x'.repeat(206) }] },
      ]) assert.equal((await bulk(data)).status, 400);
      assert.equal((await bulk({ names: [body.names[1], { unitId: 999, soaResidentName: 'Unknown' }] })).status, 404);
      assert.equal((await db.query('SELECT soa_resident_name FROM units WHERE id=10')).rows[0].soa_resident_name, 'Next Statement Name');
      const result = await bulk();
      assert.equal(result.status, 200, JSON.stringify(result.data));
      assert.deepEqual(result.data.units.map(row => [row.id, row.soaResidentName]), [[10, 'First Family'], [11, 'Second Family']]);
      const auditCount = (await db.query('SELECT COUNT(*)::int AS n FROM audit_logs')).rows[0].n;
      failAudit = 11;
      assert.equal((await bulk({ names: [{ unitId: 10, soaResidentName: 'Must roll back' }, { unitId: 11, soaResidentName: 'Also roll back' }] })).status, 500);
      failAudit = false;
      assert.deepEqual((await db.query('SELECT soa_resident_name FROM units ORDER BY id')).rows.map(row => row.soa_resident_name), ['First Family', 'Second Family']);
      assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM audit_logs')).rows[0].n, auditCount);
      assert.equal((await db.query('SELECT payer_name_snapshot FROM unit_bills WHERE id=100')).rows[0].payer_name_snapshot, 'Historical Name');
    });
  } finally {
    failAudit = false;
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    pool.query = original.query; pool.connect = original.connect;
    if (original.secret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = original.secret;
    await db.close(); await pool.end();
  }
});
