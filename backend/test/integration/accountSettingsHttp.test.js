import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import express from 'express';
import bcrypt from 'bcrypt';
import nodemailer from 'nodemailer';
import pool from '../../config/db.js';
import accountRoutes from '../../routes/accountRoutes.js';
import authRoutes from '../../routes/authRoutes.js';
import errorHandler from '../../middleware/errorHandler.js';

// Temporary PostgreSQL tables isolate all credentials and account changes.
// SMTP is intercepted; no verification email is sent to a real address.
test('admin and billing associate can securely manage their own profile, email and password', async () => {
  const client = await pool.connect();
  const query = client.query.bind(client);
  const originalQuery = pool.query, originalConnect = pool.connect, originalTransport = nodemailer.createTransport;
  const environment = Object.fromEntries(['JWT_SECRET', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'].map(key => [key, process.env[key]]));
  const deliveries = [], savepoints = [];
  let failMail = false, sequence = 0, server;
  try {
    await query('BEGIN');
    await query('CREATE TEMP TABLE users (LIKE public.users INCLUDING DEFAULTS) ON COMMIT DROP');
    await query('CREATE UNIQUE INDEX account_test_email_unique ON users (LOWER(BTRIM(email)))');
    await query('CREATE TEMP TABLE email_change_challenges (LIKE public.email_change_challenges INCLUDING ALL) ON COMMIT DROP');
    await query('CREATE TEMP TABLE password_reset_challenges (LIKE public.password_reset_challenges INCLUDING ALL) ON COMMIT DROP');
    await query('CREATE TEMP TABLE audit_logs (LIKE public.audit_logs INCLUDING DEFAULTS) ON COMMIT DROP');
    await query('ALTER TABLE audit_logs ALTER COLUMN id SET DEFAULT -1');
    const password = 'Original password 123!';
    const hash = await bcrypt.hash(password, 4);
    await query(`INSERT INTO users(id,full_name,email,password_hash,role,is_active,approval_status,email_verified)
      VALUES (-2001,'Test Admin','admin@example.invalid',$1,'ADMIN',TRUE,'APPROVED',TRUE),
             (-2002,'Test Associate','collector@example.invalid',$1,'COLLECTOR',TRUE,'APPROVED',TRUE),
             (-2003,'Test Resident','resident@example.invalid',$1,'RESIDENT',TRUE,'APPROVED',TRUE),
             (-2004,'Other Account','taken@example.invalid',$1,'RESIDENT',TRUE,'APPROVED',TRUE)`, [hash]);
    Object.assign(process.env, { JWT_SECRET: 'isolated-account-test-secret', SMTP_HOST: 'smtp.example.invalid',
      SMTP_USER: 'test', SMTP_PASSWORD: 'test', SMTP_FROM: 'staff@example.invalid' });
    nodemailer.createTransport = () => ({ async sendMail(delivery) {
      if (failMail) throw new Error('Simulated mail failure');
      deliveries.push(delivery);
    } });
    async function routeQuery(sql, values) {
      if (sql === 'BEGIN') { const name = `account_${++sequence}`; savepoints.push(name); return query(`SAVEPOINT ${name}`); }
      if (sql === 'COMMIT') return query(`RELEASE SAVEPOINT ${savepoints.pop()}`);
      if (sql === 'ROLLBACK') {
        const name = savepoints.pop();
        await query(`ROLLBACK TO SAVEPOINT ${name}`);
        return query(`RELEASE SAVEPOINT ${name}`);
      }
      return query(sql, values);
    }
    pool.query = routeQuery;
    pool.connect = async () => ({ query: routeQuery, release() {} });
    const app = express();
    app.use(express.json());
    app.use('/api/account', accountRoutes);
    app.use('/api/auth', authRoutes);
    app.use(errorHandler);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(path, body, token, method = body ? 'POST' : 'GET') {
      const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, data: await response.json() };
    }
    const login = async (email, suppliedPassword = password) => request('/api/auth/login', { email, password: suppliedPassword });
    const resident = (await login('resident@example.invalid')).data.token;
    assert.equal((await request('/api/account/profile', { fullName: 'No authorization' }, undefined, 'PATCH')).status, 401);
    assert.equal((await request('/api/account/profile', { fullName: 'Resident cannot edit staff settings' }, resident, 'PATCH')).status, 403);
    assert.equal((await request('/api/account/email-change', { email: 'resident-new@example.invalid', currentPassword: password }, resident)).status, 403);
    for (const [role, id] of [['admin', -2001], ['collector', -2002]]) {
      const originalEmail = `${role}@example.invalid`;
      const newEmail = `${role}-verified@example.invalid`;
      let token = (await login(originalEmail)).data.token;
      const beforeVersion = (await query('SELECT auth_version FROM users WHERE id=$1', [id])).rows[0].auth_version;
      assert.equal((await request('/api/account/profile', { fullName: 'Not allowed', role: 'ADMIN' }, token, 'PATCH')).status, 400);
      assert.equal((await request('/api/account/profile', { fullName: 'Not allowed', email: newEmail }, token, 'PATCH')).status, 400);
      const name = await request('/api/account/profile', { fullName: ` Updated ${role} ` }, token, 'PATCH');
      assert.equal(name.status, 200, JSON.stringify(name.data));
      assert.equal(name.data.user.fullName, `Updated ${role}`);
      assert.equal(name.data.user.role, role === 'admin' ? 'ADMIN' : 'COLLECTOR');
      assert.equal('passwordHash' in name.data.user, false);
      assert.equal((await request('/api/auth/me', undefined, token)).data.user.fullName, `Updated ${role}`);
      assert.equal((await request('/api/account/email-change', { email: newEmail, currentPassword: 'Wrong password' }, token)).status, 403);
      assert.equal((await request('/api/account/email-change', { email: originalEmail, currentPassword: password }, token)).status, 400);
      assert.equal((await request('/api/account/email-change', { email: 'TAKEN@example.invalid', currentPassword: password }, token)).status, 409);
      const send = () => request('/api/account/email-change', { email: newEmail.toUpperCase(), currentPassword: password }, token);
      const sent = await send();
      assert.equal(sent.status, 200, JSON.stringify(sent.data));
      assert.equal(sent.data.email, newEmail);
      assert.equal(deliveries.at(-1).to, newEmail);
      let challengeId = sent.data.challengeId;
      let otp = deliveries.at(-1).text.match(/code is: (\d{6})/)[1];
      assert.equal(JSON.stringify(sent.data).includes(otp), false);
      const saved = (await query('SELECT email, auth_version FROM users WHERE id=$1', [id])).rows[0];
      assert.equal(saved.email, originalEmail);
      assert.equal(saved.auth_version, beforeVersion);
      const verify = (code = otp, auth = token, challenge = challengeId) => request('/api/account/email-change/verify', { challengeId: challenge, otp: code }, auth);
      assert.equal((await verify(otp, resident)).status, 403);
      assert.equal((await verify(otp, token, randomUUID())).status, 400);
      assert.equal((await send()).status, 429);
      const wrongCode = otp === '000000' ? '111111' : '000000';
      assert.equal((await verify(wrongCode)).status, 400);
      assert.equal((await query('SELECT attempts FROM email_change_challenges WHERE id=$1', [challengeId])).rows[0].attempts, 1);
      const verified = await verify();
      assert.equal(verified.status, 200, JSON.stringify(verified.data));
      assert.equal(verified.data.user.email, newEmail);
      assert.equal(verified.data.user.emailVerified, true);
      assert.equal((await request('/api/auth/me', undefined, token)).status, 401);
      token = verified.data.token;
      assert.equal((await request('/api/auth/me', undefined, token)).status, 200);
      assert.equal((await verify()).status, 400);
      assert.equal((await login(originalEmail)).status, 401);
      assert.equal((await login(newEmail)).status, 200);

      // A second address is not saved if mail fails or the target is taken later.
      const laterEmail = `${role}-later@example.invalid`;
      failMail = true;
      assert.equal((await request('/api/account/email-change', { email: laterEmail, currentPassword: password }, token)).status, 503);
      failMail = false;
      assert.equal((await query('SELECT email FROM users WHERE id=$1', [id])).rows[0].email, newEmail);
      assert.equal((await query('SELECT COUNT(*)::int AS count FROM email_change_challenges WHERE user_id=$1', [id])).rows[0].count, 0);
      const later = await request('/api/account/email-change', { email: laterEmail, currentPassword: password }, token);
      challengeId = later.data.challengeId;
      otp = deliveries.at(-1).text.match(/code is: (\d{6})/)[1];
      const claimantId = id - 100;
      await query("INSERT INTO users(id,full_name,email,password_hash,role) VALUES($1,'Other User',$2,$3,'RESIDENT')", [claimantId, laterEmail, hash]);
      assert.equal((await verify()).status, 409);
      await query('DELETE FROM users WHERE id=$1', [claimantId]);
      await query("UPDATE email_change_challenges SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [challengeId]);
      assert.equal((await verify()).status, 400);
      await query("UPDATE email_change_challenges SET sent_at=NOW()-INTERVAL '61 seconds' WHERE user_id=$1", [id]);
      const resent = await request('/api/account/email-change', { email: laterEmail, currentPassword: password }, token);
      challengeId = resent.data.challengeId;
      otp = deliveries.at(-1).text.match(/code is: (\d{6})/)[1];
      for (let attempt = 1; attempt <= 5; attempt++) {
        assert.equal((await verify(otp === '000000' ? '111111' : '000000')).status, attempt === 5 ? 429 : 400);
      }
      assert.equal((await verify()).status, 429);

      assert.equal((await request('/api/auth/change-password', { currentPassword: 'Wrong password', newPassword: 'Changed password 456!' }, token)).status, 403);
      const changed = await request('/api/auth/change-password', { currentPassword: password, newPassword: 'Changed password 456!' }, token);
      assert.equal(changed.status, 200, JSON.stringify(changed.data));
      assert.equal((await request('/api/auth/me', undefined, token)).status, 401);
      token = changed.data.token;
      assert.equal((await request('/api/auth/me', undefined, token)).status, 200);
      assert.equal((await login(newEmail)).status, 401);
      assert.equal((await login(newEmail, 'Changed password 456!')).status, 200);
      assert.equal((await verify()).status, 400);
      assert.equal((await query('SELECT email FROM users WHERE id=$1', [id])).rows[0].email, newEmail);
    }
    assert.equal(savepoints.length, 0);
    assert.equal((await query("SELECT COUNT(*)::int AS count FROM audit_logs WHERE action='CHANGE_EMAIL'")).rows[0].count, 2);
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    nodemailer.createTransport = originalTransport;
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    if (server) await new Promise(resolve => server.close(resolve));
    await query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
