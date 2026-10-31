import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import pool from '../../config/db.js';
import assignmentRoutes from '../../routes/unitAssignmentRoutes.js';
import unitRoutes from '../../routes/unitRoutes.js';
import errorHandler from '../../middleware/errorHandler.js';

// All writes use temporary tables and an outer transaction that is rolled back.
test('unit assignments preserve manual occupancy and audit failures roll back changes', async () => {
  const client = await pool.connect();
  const query = client.query.bind(client);
  const originalQuery = pool.query, originalConnect = pool.connect;
  const originalSecret = process.env.JWT_SECRET;
  let server, failAudit = false, sequence = 0;
  const savepoints = [];
  try {
    await query('BEGIN');
    await query(`
      CREATE TEMP TABLE users (id BIGINT PRIMARY KEY, full_name TEXT, email TEXT, role TEXT, is_active BOOLEAN, auth_version INT DEFAULT 0) ON COMMIT DROP;
      CREATE TEMP TABLE units (id BIGINT PRIMARY KEY, unit_number TEXT, floor TEXT, billable_area_sqm NUMERIC,
        occupancy_status TEXT NOT NULL DEFAULT 'VACANT' CHECK (occupancy_status IN ('VACANT','OCCUPIED')),
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()) ON COMMIT DROP;
      CREATE TEMP TABLE unit_assignments (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        unit_id BIGINT REFERENCES units(id), user_id BIGINT REFERENCES users(id), relationship_type TEXT,
        is_primary_payer BOOLEAN, start_date DATE, end_date DATE,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT unit_assignments_unique_assignment UNIQUE (unit_id,user_id,start_date)) ON COMMIT DROP;
      CREATE UNIQUE INDEX unit_assignments_active_user_unit_unique ON unit_assignments(unit_id,user_id) WHERE end_date IS NULL;
      CREATE TEMP TABLE audit_logs (context JSONB,actor_user_id BIGINT, actor_name_snapshot TEXT, actor_role_snapshot TEXT,
        entity_name TEXT, entity_id BIGINT, action TEXT, old_values JSONB, new_values JSONB, remarks TEXT) ON COMMIT DROP;
      ALTER TABLE users ADD COLUMN approval_status TEXT DEFAULT 'APPROVED';
      INSERT INTO users(id,full_name,email,role,is_active) VALUES
        (1,'Test Admin','admin@example.invalid','ADMIN',TRUE),
        (2,'Test Owner','owner@example.invalid','RESIDENT',TRUE),
        (3,'Test Tenant','tenant@example.invalid','RESIDENT',TRUE),
        (4,'Inactive Resident','inactive@example.invalid','RESIDENT',FALSE);
      INSERT INTO units(id,unit_number,floor,billable_area_sqm) VALUES
        (10,'Test 10','1',12.07),(20,'Test 20','2',12.07),(30,'Test 30','3',12.07),(40,'Test 40','4',12.07);
    `);
    async function routeQuery(sql, values) {
      if (sql === 'BEGIN') { const name = `occupancy_${++sequence}`; savepoints.push(name); return query(`SAVEPOINT ${name}`); }
      if (sql === 'COMMIT') return query(`RELEASE SAVEPOINT ${savepoints.pop()}`);
      if (sql === 'ROLLBACK') {
        const name = savepoints.pop();
        await query(`ROLLBACK TO SAVEPOINT ${name}`);
        return query(`RELEASE SAVEPOINT ${name}`);
      }
      if (failAudit && sql.includes('INSERT INTO audit_logs')) {
        throw Object.assign(new Error('Simulated write failure'), { status: 503 });
      }
      return query(sql, values);
    }
    pool.query = routeQuery;
    pool.connect = async () => ({ query: routeQuery, release() {} });
    process.env.JWT_SECRET = 'isolated-unit-occupancy-test';
    const token = jwt.sign({ id: 1, authVersion: 0 }, process.env.JWT_SECRET);
    const app = express();
    app.use(express.json());
    app.use('/api/unit-assignments', assignmentRoutes);
    app.use('/api/units', unitRoutes);
    app.use(errorHandler);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    async function request(path, body, method = 'POST') {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, data: await response.json() };
    }
    const occupancy = async id => (await query('SELECT occupancy_status FROM units WHERE id=$1', [id])).rows[0].occupancy_status;
    const assign = (unitId, userId = 2, extra = {}) => request('/api/unit-assignments', { unitId, userId, relationshipType: 'OWNER', ...extra });

    const owner = await assign(10);
    assert.equal(owner.status, 201, JSON.stringify(owner.data));
    assert.equal(await occupancy(10), 'VACANT');
    assert.equal((await request('/api/units/10', undefined, 'GET')).data.unit.occupancyStatus, 'VACANT');
    const tenant = await assign(10, 3, { relationshipType: 'TENANT' });
    assert.equal(tenant.status, 201);
    assert.equal(await occupancy(10), 'VACANT');
    assert.equal((await assign(10)).status, 409);
    assert.equal((await assign(20, 4)).status, 409);
    assert.equal(await occupancy(20), 'VACANT');

    for (const occupancyStatus of ['OCCUPIED', 'VACANT']) {
      const saved = await request('/api/units/10', { occupancyStatus, floor: 'Updated floor' }, 'PATCH');
      assert.equal(saved.status, 200, JSON.stringify(saved.data));
      assert.equal(saved.data.unit.occupancyStatus, occupancyStatus);
      assert.equal(saved.data.unit.floor, 'Updated floor');
    }
    const changed = await request(`/api/unit-assignments/${owner.data.assignment.id}`, { relationshipType: 'TENANT', isPrimaryPayer: true }, 'PATCH');
    assert.equal(changed.status, 200);
    assert.equal(changed.data.assignment.isPrimaryPayer, true);
    assert.equal(await occupancy(10), 'VACANT');
    await request('/api/units/10', { occupancyStatus: 'OCCUPIED' }, 'PATCH');
    assert.equal((await request(`/api/unit-assignments/${owner.data.assignment.id}`, undefined, 'DELETE')).status, 200);
    assert.equal((await request(`/api/unit-assignments/${tenant.data.assignment.id}`, undefined, 'DELETE')).status, 200);
    assert.equal(await occupancy(10), 'OCCUPIED', 'Ending the last assignment must preserve occupancy');

    const historical = await assign(20, 2, { startDate: '2026-01-01', endDate: '2026-01-31' });
    assert.equal(historical.status, 201);
    assert.equal(await occupancy(20), 'VACANT');
    assert.equal((await request(`/api/unit-assignments/${historical.data.assignment.id}`, { endDate: null }, 'PATCH')).status, 200);
    assert.equal(await occupancy(20), 'VACANT');
    await request('/api/units/30', { occupancyStatus: 'OCCUPIED' }, 'PATCH');
    const moved = await request(`/api/unit-assignments/${historical.data.assignment.id}`, { unitId: 30 }, 'PATCH');
    assert.equal(moved.status, 200);
    assert.equal(await occupancy(20), 'VACANT');
    assert.equal(await occupancy(30), 'OCCUPIED');
    const anotherOwner = await assign(30, 3);
    assert.equal(anotherOwner.status, 201);
    assert.equal(await occupancy(30), 'OCCUPIED');

    failAudit = true;
    assert.equal((await assign(40)).status, 503);
    assert.equal((await query('SELECT COUNT(*)::int AS count FROM unit_assignments WHERE unit_id=40')).rows[0].count, 0);
    assert.equal((await request(`/api/unit-assignments/${historical.data.assignment.id}`, { unitId: 40 }, 'PATCH')).status, 503);
    assert.equal((await query('SELECT unit_id FROM unit_assignments WHERE id=$1', [historical.data.assignment.id])).rows[0].unit_id, '30');
    assert.equal((await request(`/api/unit-assignments/${historical.data.assignment.id}`, undefined, 'DELETE')).status, 503);
    assert.equal((await query('SELECT end_date FROM unit_assignments WHERE id=$1', [historical.data.assignment.id])).rows[0].end_date, null);
    assert.equal((await request('/api/units/40', { occupancyStatus: 'OCCUPIED' }, 'PATCH')).status, 503);
    assert.equal(await occupancy(40), 'VACANT');
    failAudit = false;
    const assignmentAudit = await query("SELECT context FROM audit_logs WHERE entity_name='UNIT_ASSIGNMENT'");
    assert.ok(assignmentAudit.rows.length > 0);
    assert.ok(assignmentAudit.rows.every(row => !(row.context?.affectedRecords || []).some(record => record.entityName === 'UNIT')));

  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    pool.query = originalQuery;
    pool.connect = originalConnect;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
    await query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
