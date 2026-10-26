import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import pool from '../../config/db.js';
import userRoutes from '../../routes/userRoutes.js';
import errorHandler from '../../middleware/errorHandler.js';

// Real HTTP + PostgreSQL constraints, using only temporary tables and an outer
// rollback. No production account, report, statement, payment, or audit is changed.
test('account deletion removes its submitted reports atomically and preserves other records', async () => {
  const client = await pool.connect();
  const query = client.query.bind(client);
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const originalSecret = process.env.JWT_SECRET;
  let server;
  let failAudit = false;
  let sequence = 0;
  const savepoints = [];
  try {
    await query('BEGIN');
    await query(`CREATE TEMP TABLE users (LIKE public.users INCLUDING DEFAULTS) ON COMMIT DROP;
      ALTER TABLE users ADD PRIMARY KEY(id);
      CREATE TEMP TABLE units (id BIGINT PRIMARY KEY, unit_number TEXT) ON COMMIT DROP;
      INSERT INTO units VALUES(10,'Test 10');
      CREATE TEMP TABLE unit_bills (id BIGINT PRIMARY KEY) ON COMMIT DROP;
      CREATE TEMP TABLE unit_assignments (id BIGINT PRIMARY KEY, unit_id BIGINT,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, end_date DATE, relationship_type TEXT DEFAULT 'OWNER') ON COMMIT DROP;
      CREATE TEMP TABLE billing_error_reports (id BIGINT PRIMARY KEY,
        unit_bill_id BIGINT REFERENCES unit_bills(id) ON DELETE CASCADE,
        reported_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        resolved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
        status TEXT, description TEXT) ON COMMIT DROP;
      CREATE TEMP TABLE payment_submissions (id BIGINT PRIMARY KEY,
        submitted_by BIGINT REFERENCES users(id) ON DELETE SET NULL, amount NUMERIC) ON COMMIT DROP;
      CREATE TEMP TABLE audit_logs (context JSONB,actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
        actor_name_snapshot TEXT, actor_role_snapshot TEXT, entity_name TEXT, entity_id BIGINT,
        action TEXT, old_values JSONB, new_values JSONB, remarks TEXT) ON COMMIT DROP;`);
    const adminPassword = 'TestAdmin7!xy';
    const hash = await bcrypt.hash(adminPassword, 4);
    await query(`INSERT INTO users(id,full_name,email,password_hash,role,is_active,auth_version) VALUES
      (1,'Deletion Admin','admin@example.invalid',$1,'ADMIN',TRUE,0),
      (2,'Deletion Target','target@example.invalid',$1,'RESIDENT',TRUE,0),
      (3,'Other Resident','other@example.invalid',$1,'RESIDENT',TRUE,0),
      (4,'Test Associate','associate@example.invalid',$1,'COLLECTOR',TRUE,0),
      (5,'No Reports Resident','empty@example.invalid',$1,'RESIDENT',TRUE,0)`,[hash]);
    await query(`INSERT INTO unit_bills VALUES(10);
      INSERT INTO unit_assignments(id,unit_id,user_id) VALUES(20,10,2),(21,10,3);
      INSERT INTO billing_error_reports VALUES
        (11,10,2,NULL,'OPEN','Target open report'),
        (12,10,2,1,'RESOLVED','Target resolved report'),
        (13,10,3,2,'RESOLVED','Other resident report'),
        (14,10,4,NULL,'OPEN','Associate report');
      INSERT INTO payment_submissions VALUES(30,2,123.45);`);
    async function routeQuery(sql, values) {
      if (sql === 'BEGIN') { const name = `deletion_${++sequence}`; savepoints.push(name); return query(`SAVEPOINT ${name}`); }
      if (sql === 'COMMIT') return query(`RELEASE SAVEPOINT ${savepoints.pop()}`);
      if (sql === 'ROLLBACK') {
        const name = savepoints.pop();
        await query(`ROLLBACK TO SAVEPOINT ${name}`);
        return query(`RELEASE SAVEPOINT ${name}`);
      }
      if (failAudit && sql.includes('INSERT INTO audit_logs')) throw Object.assign(new Error('Simulated audit failure'), { status: 503 });
      return query(sql, values);
    }
    pool.query = routeQuery;
    pool.connect = async () => ({ query: routeQuery, release() {} });
    process.env.JWT_SECRET = 'isolated-account-deletion-test';
    const adminToken = jwt.sign({ id: 1, authVersion: 0 }, process.env.JWT_SECRET);
    const residentToken = jwt.sign({ id: 3, authVersion: 0 }, process.env.JWT_SECRET);
    const app = express();
    app.use(express.json());
    app.use('/api/users', userRoutes);
    app.use(errorHandler);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    async function remove(id, body = {}, token = adminToken) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/users/${id}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
      return { status: response.status, data: await response.json() };
    }
    const count = async (table, column, id) => (await query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE ${column}=$1`,[id])).rows[0].count;

    assert.equal((await remove(2, {}, '')).status, 401);
    assert.equal((await remove(2, {}, residentToken)).status, 403);
    assert.equal((await remove(1)).status, 403);
    assert.equal((await remove(999)).status, 404);
    assert.equal(await count('billing_error_reports','reported_by',2), 2);

    const assigned = await remove(2);
    assert.equal(assigned.status, 409);
    assert.equal(assigned.data.code, 'USER_ASSIGNED_TO_UNIT');
    assert.equal(await count('billing_error_reports','reported_by',2), 2);
    await query('UPDATE unit_assignments SET end_date=CURRENT_DATE WHERE user_id=2');

    failAudit = true;
    assert.equal((await remove(2)).status, 503);
    assert.equal(await count('users','id',2), 1);
    assert.equal(await count('billing_error_reports','reported_by',2), 2);
    assert.equal(await count('unit_assignments','user_id',2), 1);
    assert.equal(Number((await query('SELECT submitted_by FROM payment_submissions WHERE id=30')).rows[0].submitted_by), 2);
    failAudit = false;

    const removed = await remove(2);
    assert.equal(removed.status, 200, JSON.stringify(removed.data));
    assert.equal(removed.data.removedBillingErrorReports, 2);
    assert.equal(removed.data.removedAssignments, 1);
    assert.equal(await count('users','id',2), 0);
    assert.equal(await count('billing_error_reports','reported_by',2), 0);
    assert.equal(await count('unit_assignments','user_id',2), 0);
    assert.equal(await count('billing_error_reports','reported_by',3), 1);
    assert.equal(await count('unit_assignments','user_id',3), 1);
    assert.equal((await query('SELECT resolved_by FROM billing_error_reports WHERE id=13')).rows[0].resolved_by, null);
    assert.equal(await count('unit_bills','id',10), 1);
    const payment = (await query('SELECT submitted_by,amount FROM payment_submissions WHERE id=30')).rows[0];
    assert.equal(payment.submitted_by, null);
    assert.equal(Number(payment.amount), 123.45);
    const audit = (await query("SELECT old_values FROM audit_logs WHERE entity_id=2 AND action='DELETE'")).rows[0].old_values;
    assert.equal(audit.removedBillingErrorReports, 2);
    assert.equal(audit.removedAssignments, 1);

    assert.equal((await remove(4)).status, 400);
    assert.equal((await remove(4, { currentPassword: 'wrongpass' })).status, 403);
    assert.equal(await count('billing_error_reports','reported_by',4), 1);
    assert.equal(await count('users','id',4), 1);
    const privileged = await remove(4, { currentPassword: adminPassword });
    assert.equal(privileged.status, 200);
    assert.equal(privileged.data.removedBillingErrorReports, 1);
    const empty = await remove(5);
    assert.equal(empty.status, 200);
    assert.equal(empty.data.removedBillingErrorReports, 0);
    assert.equal(empty.data.removedAssignments, 0);
    assert.equal((await remove(2)).status, 404);
    assert.equal(savepoints.length, 0);
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
    if (server) await new Promise(resolve => server.close(resolve));
    await query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
