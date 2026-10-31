import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import pool from '../../config/db.js';
import dashboardRoutes from '../../routes/dashboardRoutes.js';
import errorHandler from '../../middleware/errorHandler.js';

test('dashboard counts enabled resident accounts independently of assignments and occupancy', async () => {
  const client = await pool.connect(), query = client.query.bind(client);
  const originalQuery = pool.query, originalConnect = pool.connect, originalSecret = process.env.JWT_SECRET;
  let server;
  try {
    await query('BEGIN');
    await query(`
      CREATE TEMP TABLE users(id BIGINT PRIMARY KEY, role TEXT, is_active BOOLEAN, approval_status TEXT, auth_version INTEGER) ON COMMIT DROP;
      INSERT INTO users VALUES (1,'ADMIN',TRUE,'APPROVED',0),(2,'COLLECTOR',TRUE,'APPROVED',0),
        (3,'RESIDENT',TRUE,'APPROVED',0),(4,'RESIDENT',TRUE,'APPROVED',0),
        (5,'RESIDENT',TRUE,'APPROVED',0),(6,'RESIDENT',FALSE,'APPROVED',0);
      CREATE TEMP TABLE units(id BIGINT PRIMARY KEY, occupancy_status TEXT) ON COMMIT DROP;
      INSERT INTO units VALUES(10,'VACANT'),(20,'OCCUPIED'),(30,'VACANT');
      CREATE TEMP TABLE unit_assignments(unit_id BIGINT,user_id BIGINT,end_date DATE) ON COMMIT DROP;
      INSERT INTO unit_assignments VALUES(10,3,NULL),(20,3,NULL),(30,3,NULL),(20,4,NULL),(20,6,NULL);
      CREATE TEMP TABLE payment_ledger_policy(id INTEGER,version INTEGER) ON COMMIT DROP;
      INSERT INTO payment_ledger_policy VALUES(1,2);
      CREATE TEMP TABLE billing_periods(id BIGINT,period_start DATE,period_type TEXT,status TEXT) ON COMMIT DROP;
      CREATE TEMP TABLE unit_bills(id BIGINT,unit_id BIGINT,billing_period_id BIGINT,due_date_snapshot DATE,late_penalty_amount NUMERIC,late_penalty_percent_snapshot NUMERIC) ON COMMIT DROP;
      CREATE TEMP TABLE bill_charges(unit_bill_id BIGINT,charge_type TEXT,quantity NUMERIC,rate_applied NUMERIC) ON COMMIT DROP;
      CREATE TEMP TABLE payment_applications(unit_bill_id BIGINT,charge_allocation_id BIGINT,amount_applied NUMERIC,component TEXT) ON COMMIT DROP;
      CREATE TEMP TABLE payment_charge_allocations(id BIGINT,payment_submission_id BIGINT,charge_type TEXT) ON COMMIT DROP;
      CREATE TEMP TABLE payment_submissions(id BIGINT,review_status TEXT,verified_payment_date DATE) ON COMMIT DROP;
      CREATE TEMP TABLE prescriptive_recommendations(based_on_period_id BIGINT,status TEXT,priority TEXT) ON COMMIT DROP;
      CREATE TEMP TABLE meter_readings(billing_period_id BIGINT,previous_reading NUMERIC,current_reading NUMERIC,validation_status TEXT) ON COMMIT DROP;
    `);
    let pendingQuery = Promise.resolve();
    pool.query = (sql, values) => {
      const result = pendingQuery.then(() => query(sql, values));
      pendingQuery = result.catch(() => {});
      return result;
    };
    pool.connect = async () => ({
      query: (sql, values) => sql === 'BEGIN' ? query('SAVEPOINT dashboard_test')
        : sql === 'COMMIT' ? query('RELEASE SAVEPOINT dashboard_test')
          : sql === 'ROLLBACK' ? query('ROLLBACK TO SAVEPOINT dashboard_test') : query(sql, values),
      release() {},
    });
    process.env.JWT_SECRET = 'isolated-dashboard-account-count';
    const app = express(); app.use('/api/dashboard', dashboardRoutes); app.use(errorHandler);
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/dashboard/overview`;
    const request = id => fetch(url, { headers: { Authorization: `Bearer ${jwt.sign({ id, authVersion: 0 }, process.env.JWT_SECRET)}` } });
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await request(3)).status, 403);
    for (const id of [1, 2]) {
      const response = await request(id);
      const data = await response.json();
      assert.equal(response.status, 200, JSON.stringify(data));
      assert.equal(data.metrics.activeResidentAccounts, 3, 'Multi-unit owners count once, unassigned accounts count, staff and inactive accounts do not');
      assert.equal(data.metrics.occupiedUnits, 1);
      assert.equal(data.metrics.vacantUnits, 2);
      assert.ok(Array.isArray(data.monthly));
      assert.ok(Array.isArray(data.billStatus));
    }
    await query('DELETE FROM unit_assignments');
    assert.equal((await (await request(1)).json()).metrics.activeResidentAccounts, 3);
    await query('UPDATE users SET is_active=FALSE WHERE id=5');
    assert.equal((await (await request(1)).json()).metrics.activeResidentAccounts, 2);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    pool.query = originalQuery; pool.connect = originalConnect;
    if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret;
    await query('ROLLBACK'); client.release(); await pool.end();
  }
});
