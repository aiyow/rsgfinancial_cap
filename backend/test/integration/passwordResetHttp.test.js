import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import bcrypt from 'bcrypt';
import nodemailer from 'nodemailer';
import pool from '../../config/db.js';
import authRoutes from '../../routes/authRoutes.js';
import errorHandler from '../../middleware/errorHandler.js';

// Real PostgreSQL and HTTP routes, with temporary tables and intercepted email.
// No account, password, or email in the configured database is changed.
test('email OTP recovery and login agree, including legacy duplicate accounts', async () => {
  const client = await pool.connect();
  const query = client.query.bind(client);
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const originalTransport = nodemailer.createTransport;
  const environment = Object.fromEntries(['JWT_SECRET', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'].map(key => [key, process.env[key]]));
  const mail = [];
  let failMail = false;
  let failAudit = false;
  let server;
  const savepoints = [];
  let sequence = 0;
  try {
    await query('BEGIN');
    await query('CREATE TEMP TABLE users (LIKE public.users INCLUDING DEFAULTS) ON COMMIT DROP');
    await query('CREATE TEMP TABLE password_reset_challenges (LIKE public.password_reset_challenges INCLUDING ALL) ON COMMIT DROP');
    await query('CREATE TEMP TABLE audit_logs (LIKE public.audit_logs INCLUDING DEFAULTS) ON COMMIT DROP');
    await query('ALTER TABLE audit_logs ALTER COLUMN id SET DEFAULT -1');
    const oldHash = await bcrypt.hash('Old password 123!', 4);
    await query(`INSERT INTO users(id,full_name,email,password_hash,role,is_active,approval_status,email_verified,created_at)
      VALUES (-1001,'Recovery Test','reset@example.invalid',$1,'RESIDENT',TRUE,'APPROVED',TRUE,'2026-01-01'),
             (-1002,'Legacy Duplicate',' RESET@example.invalid ',$1,'RESIDENT',TRUE,'APPROVED',TRUE,'2026-02-01'),
             (-1003,'Pending','pending@example.invalid',$1,'RESIDENT',TRUE,'PENDING',FALSE,'2026-01-01'),
             (-1004,'Inactive','inactive@example.invalid',$1,'RESIDENT',FALSE,'APPROVED',TRUE,'2026-01-01')`, [oldHash]);
    process.env.JWT_SECRET = 'isolated-auth-regression-secret';
    Object.assign(process.env, { SMTP_HOST: 'smtp.example.invalid', SMTP_USER: 'test', SMTP_PASSWORD: 'test', SMTP_FROM: 'test@example.invalid' });
    nodemailer.createTransport = () => ({ async sendMail(message) {
      if (failMail) throw new Error('Simulated mail failure');
      mail.push(message);
    } });
    async function routeQuery(sql, values) {
      if (sql === 'BEGIN') {
        const name = `auth_${++sequence}`;
        savepoints.push(name);
        return query(`SAVEPOINT ${name}`);
      }
      if (sql === 'COMMIT') return query(`RELEASE SAVEPOINT ${savepoints.pop()}`);
      if (sql === 'ROLLBACK') {
        const name = savepoints.pop();
        await query(`ROLLBACK TO SAVEPOINT ${name}`);
        return query(`RELEASE SAVEPOINT ${name}`);
      }
      if (failAudit && /INSERT INTO audit_logs/.test(sql)) {
        const error = new Error('Simulated audit failure');
        error.status = 503;
        throw error;
      }
      return query(sql, values);
    }
    pool.query = routeQuery;
    pool.connect = async () => ({ query: routeQuery, release() {} });
    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);
    app.use(errorHandler);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;
    async function request(path, body, token) {
      const response = await fetch(baseUrl + path, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, data: await response.json() };
    }
    const email = 'reset@example.invalid';
    const initialLogin = await request('/login', { email, password: 'Old password 123!' });
    assert.equal(initialLogin.status, 200);
    assert.equal(Number(initialLogin.data.user.id), -1001);
    let sent = await request('/forgot-password', { email: ' RESET@EXAMPLE.INVALID ' });
    assert.equal(sent.status, 200, JSON.stringify(sent.data));
    assert.equal(mail.length, 1);
    let otp = mail.at(-1).text.match(/code is: (\d{6})/)[1];
    let challengeId = sent.data.challengeId;
    assert.equal(JSON.stringify(sent.data).includes(otp), false);
    const stored = (await query('SELECT * FROM password_reset_challenges WHERE id=$1', [challengeId])).rows[0];
    assert.equal(Number(stored.user_id), -1001);
    assert.notEqual(stored.otp_hash, otp);
    const cooldown = await request('/forgot-password', { email });
    assert.equal(cooldown.data.challengeId, challengeId);
    assert.equal(mail.length, 1);
    for (const address of ['missing@example.invalid', 'pending@example.invalid', 'inactive@example.invalid']) {
      const result = await request('/forgot-password', { email: address });
      assert.equal(result.status, 200);
      assert.equal(result.data.message, sent.data.message);
      assert.deepEqual(Object.keys(result.data).sort(), Object.keys(sent.data).sort());
    }
    assert.equal(mail.length, 1);
    const newPassword = ' New password 456! ';
    const verifyBody = () => ({ email, challengeId, otp });
    let resetToken = 'unverified-token-'.padEnd(43, 'x');
    const resetBody = () => ({ email, resetToken, password: newPassword });
    assert.equal((await request('/reset-password', resetBody())).status, 400);
    assert.equal((await request('/reset-password', { ...resetBody(), email: 'pending@example.invalid' })).status, 400);
    assert.equal((await request('/reset-password', { token: 'old-reset-link', password: newPassword })).status, 400);
    assert.equal((await request('/reset-password', { ...verifyBody(), password: newPassword })).status, 400);
    assert.equal((await request('/verify-password-reset-otp', { ...verifyBody(), otp: '12345' })).status, 400);
    const wrongOtp = otp === '000000' ? '111111' : '000000';
    assert.equal((await request('/verify-password-reset-otp', { ...verifyBody(), otp: wrongOtp })).status, 400);
    assert.equal((await query('SELECT attempts FROM password_reset_challenges WHERE id=$1', [challengeId])).rows[0].attempts, 1);
    const verified = await request('/verify-password-reset-otp', verifyBody());
    assert.equal(verified.status, 200, JSON.stringify(verified.data));
    resetToken = verified.data.resetToken;
    assert.ok(resetToken.length >= 40);
    assert.equal(await bcrypt.compare('Old password 123!', (await query('SELECT password_hash FROM users WHERE id=-1001')).rows[0].password_hash), true);
    assert.equal((await request('/verify-password-reset-otp', verifyBody())).status, 400);
    assert.equal((await request('/reset-password', { ...resetBody(), resetToken: 'invalid-token-'.padEnd(43, 'x') })).status, 400);
    failAudit = true;
    assert.equal((await request('/reset-password', resetBody())).status, 503);
    failAudit = false;
    assert.equal(await bcrypt.compare('Old password 123!', (await query('SELECT password_hash FROM users WHERE id=-1001')).rows[0].password_hash), true);
    assert.ok((await query('SELECT password_reset_token_hash FROM users WHERE id=-1001')).rows[0].password_reset_token_hash);
    const reset = await request('/reset-password', resetBody());
    assert.equal(reset.status, 200, JSON.stringify(reset.data));
    const login = await request('/login', { email: ' RESET@EXAMPLE.INVALID ', password: newPassword });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    assert.equal(Number(login.data.user.id), -1001);
    assert.equal((await request('/me', undefined, login.data.token)).status, 200);
    assert.equal((await request('/me', undefined, initialLogin.data.token)).status, 401);
    assert.equal((await request('/login', { email, password: 'Old password 123!' })).status, 401);
    assert.equal((await request('/reset-password', resetBody())).status, 400);
    assert.equal(await bcrypt.compare('Old password 123!', (await query('SELECT password_hash FROM users WHERE id=-1002')).rows[0].password_hash), true);
    assert.equal((await query("SELECT COUNT(*)::int AS count FROM audit_logs WHERE action='PASSWORD_RESET'")).rows[0].count, 1);

    sent = await request('/forgot-password', { email });
    challengeId = sent.data.challengeId;
    otp = mail.at(-1).text.match(/code is: (\d{6})/)[1];
    const wrongCode = otp === '000000' ? '111111' : '000000';
    for (let attempt = 1; attempt <= 5; attempt++) {
      assert.equal((await request('/verify-password-reset-otp', { ...verifyBody(), otp: wrongCode })).status, attempt === 5 ? 429 : 400);
    }
    assert.equal((await request('/verify-password-reset-otp', verifyBody())).status, 429);
    await query("UPDATE users SET password_reset_last_sent_at=NOW()-INTERVAL '61 seconds' WHERE id=-1001");
    const previousId = challengeId;
    sent = await request('/forgot-password', { email });
    challengeId = sent.data.challengeId;
    otp = mail.at(-1).text.match(/code is: (\d{6})/)[1];
    assert.notEqual(challengeId, previousId);
    assert.equal((await request('/verify-password-reset-otp', { ...verifyBody(), challengeId: previousId })).status, 400);
    const freshVerification = await request('/verify-password-reset-otp', verifyBody());
    assert.equal(freshVerification.status, 200);
    resetToken = freshVerification.data.resetToken;
    await query("UPDATE users SET password_reset_expires_at=NOW()-INTERVAL '1 second' WHERE id=-1001");
    assert.equal((await request('/reset-password', resetBody())).status, 400);
    await query("UPDATE users SET password_reset_last_sent_at=NOW()-INTERVAL '61 seconds' WHERE id=-1001");
    sent = await request('/forgot-password', { email });
    challengeId = sent.data.challengeId;
    otp = mail.at(-1).text.match(/code is: (\d{6})/)[1];
    await query("UPDATE password_reset_challenges SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [challengeId]);
    assert.equal((await request('/verify-password-reset-otp', verifyBody())).status, 400);

    // A mail outage must not replace an existing code or start a new cooldown.
    await query("UPDATE users SET password_reset_last_sent_at=NOW()-INTERVAL '61 seconds' WHERE id=-1001");
    failMail = true;
    assert.equal((await request('/forgot-password', { email })).status, 503);
    assert.equal((await query('SELECT id FROM password_reset_challenges WHERE user_id=-1001')).rows[0].id, challengeId);
    assert.equal(savepoints.length, 0);
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    nodemailer.createTransport = originalTransport;
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (server) await new Promise(resolve => server.close(resolve));
    await query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
