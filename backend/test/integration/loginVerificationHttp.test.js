import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import bcrypt from 'bcrypt';
import express from 'express';
import nodemailer from 'nodemailer';
import pool from '../../config/db.js';
import authRoutes from '../../routes/authRoutes.js';
import errorHandler from '../../middleware/errorHandler.js';

const { subtle } = webcrypto;

async function newBrowser() {
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const publicKey = Buffer.from(await subtle.exportKey('spki', pair.publicKey)).toString('base64url');
  return {
    publicKey,
    async sign(challengeId) {
      const message = Buffer.from(`residens-trusted-browser:${challengeId}`);
      return Buffer.from(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, message)).toString('base64url');
    },
  };
}

test('HTTP sign-in requires a one-time code or a valid proof from a browser trusted for 15 days', async t => {
  const db = new PGlite();
  const original = { query: pool.query, connect: pool.connect, transport: nodemailer.createTransport };
  const environment = {
    JWT_SECRET: 'isolated-sign-in-secret', LOGIN_OTP_RECOVERY_ADMIN_EMAIL: '',
    SMTP_HOST: 'smtp.example.invalid', SMTP_USER: 'fixture', SMTP_PASSWORD: 'fixture', SMTP_FROM: 'fixture@example.invalid',
  };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  const messages = [];
  let failMail = false;
  let server;
  let tail = Promise.resolve();

  try {
    const schema = await readFile(new URL('../../database/schema.sql', import.meta.url), 'utf8');
    await db.exec(schema.match(/CREATE TABLE IF NOT EXISTS users \([\s\S]*?\n\);/)[0]);
    for (const migration of ['039_registration_email_otp.sql', '048_login_verification.sql']) {
      await db.exec(await readFile(new URL(`../../database/migrations/${migration}`, import.meta.url), 'utf8'));
    }

    const password = 'Fixture-password-7!';
    const hash = await bcrypt.hash(password, 4);
    await db.query(`INSERT INTO users(id,full_name,email,password_hash,role,approval_status,is_active)
      VALUES (1,'Resident','resident@example.invalid',$1,'RESIDENT','APPROVED',TRUE),
             (2,'Admin','admin@example.invalid',$1,'ADMIN','APPROVED',TRUE),
             (3,'Pending','pending@example.invalid',$1,'RESIDENT','PENDING',TRUE),
             (4,'Inactive','inactive@example.invalid',$1,'COLLECTOR','APPROVED',FALSE)`, [hash]);

    Object.assign(process.env, environment);
    nodemailer.createTransport = () => ({ async sendMail(message) {
      if (failMail) throw new Error('Fixture mail failure');
      messages.push(message);
    } });

    pool.connect = async () => {
      const previousRequest = tail;
      let release;
      tail = new Promise(resolve => { release = resolve; });
      await previousRequest;
      return { query: db.query.bind(db), release };
    };
    pool.query = async (...args) => {
      const client = await pool.connect();
      try { return await client.query(...args); }
      finally { client.release(); }
    };

    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);
    app.use(errorHandler);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject));
    const base = `http://127.0.0.1:${server.address().port}/api/auth`;

    async function request(path, body, token) {
      const response = await fetch(base + path, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : token ? { Authorization: `Bearer ${token}` } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: response.status, data: await response.json(), retry: response.headers.get('Retry-After') };
    }
    const login = (email, options) => request('/login', { email: `${email}@example.invalid`, password, ...options });
    const verify = (challengeId, fields) => request('/login/verify', { challengeId, ...fields });
    const getCode = () => messages.at(-1).text.match(/sign-in code is: (\d{6})/)[1];
    const row = async (sql, params) => (await db.query(sql, params)).rows[0];

    await t.test('wrong passwords and ineligible accounts send no code and create no session', async () => {
      assert.equal((await login('resident', { password: 'bad' })).status, 401);
      assert.equal((await login('unknown')).status, 401);
      assert.equal((await login('pending')).data.code, 'ACCOUNT_APPROVAL_REQUIRED');
      assert.equal((await login('inactive')).status, 403);
      assert.equal((await verify(randomUUID(), { otp: '123456' })).status, 400);
      assert.equal(messages.length, 0);
    });

    let trustedBrowserId;
    const browser = await newBrowser();
    await t.test('code delivery precedes account access and opt-in enrollment sets a fixed expiry', async () => {
      const result = await login('resident');
      assert.equal(result.status, 202);
      assert.equal(result.data.code, 'LOGIN_OTP_REQUIRED');
      assert.equal(result.data.token, undefined);
      assert.equal(messages.at(-1).to, 'resident@example.invalid');
      const { challengeId } = result.data;
      const otp = getCode();
      assert.equal((await request('/me', null, challengeId)).status, 401);
      assert.match((await row('SELECT otp_hash FROM login_challenges WHERE id=$1', [challengeId])).otp_hash, /^[a-f0-9]{64}$/);
      const attempts = await Promise.all([
        verify(challengeId, { otp, publicKey: browser.publicKey }),
        verify(challengeId, { otp, publicKey: browser.publicKey }),
      ]);
      assert.deepEqual(attempts.map(result => result.status).sort(), [200, 400]);
      const session = attempts.find(result => result.status === 200).data;
      trustedBrowserId = session.trustedBrowserId;
      assert.equal((await request('/me', null, session.token)).data.user.email, 'resident@example.invalid');
      assert.equal(session.user.passwordHash, undefined);
      const expiry = await row(`SELECT EXTRACT(EPOCH FROM expires_at-NOW())::int AS seconds
        FROM login_trusted_browsers WHERE id=$1`, [trustedBrowserId]);
      assert.ok(expiry.seconds >= 15 * 86400 - 5 && expiry.seconds <= 15 * 86400);
    });

    await t.test('same browser still needs the correct password and a fresh signed challenge', async () => {
      const sent = messages.length;
      const expiry = (await row('SELECT expires_at FROM login_trusted_browsers WHERE id=$1', [trustedBrowserId])).expires_at;
      assert.equal((await login('resident', { trustedBrowserId, password: 'wrong' })).status, 401);
      const known = await login('resident', { trustedBrowserId });
      assert.equal(known.status, 202);
      assert.equal(known.data.code, 'LOGIN_BROWSER_PROOF_REQUIRED');
      assert.equal(known.data.token, undefined);
      const { challengeId } = known.data;
      const impostor = await newBrowser();
      assert.equal((await verify(challengeId, { signature: await impostor.sign(challengeId) })).status, 409);
      assert.equal((await verify(challengeId, { signature: await browser.sign(randomUUID()) })).status, 409);
      const signature = await browser.sign(challengeId);
      const session = await verify(challengeId, { signature });
      assert.equal(session.status, 200);
      assert.equal((await request('/me', null, session.data.token)).status, 200);
      assert.equal((await verify(challengeId, { signature })).status, 400);
      assert.equal(messages.length, sent);
      assert.deepEqual((await row('SELECT expires_at FROM login_trusted_browsers WHERE id=$1', [trustedBrowserId])).expires_at, expiry);
    });

    await t.test('separate browsers, other accounts, expired trust and changed credentials require a code', async () => {
      const fresh = await login('resident');
      assert.equal(fresh.data.code, 'LOGIN_OTP_REQUIRED');
      const untrusted = await verify(fresh.data.challengeId, { otp: getCode() });
      assert.equal(untrusted.status, 200);
      assert.equal(untrusted.data.trustedBrowserId, undefined);
      assert.equal((await login('admin', { trustedBrowserId })).data.code, 'LOGIN_OTP_REQUIRED');
      const expired = await login('resident', { trustedBrowserId });
      await db.query("UPDATE login_trusted_browsers SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [trustedBrowserId]);
      assert.equal((await verify(expired.data.challengeId, { signature: await browser.sign(expired.data.challengeId) })).status, 409);
      assert.equal((await login('resident', { trustedBrowserId })).data.code, 'LOGIN_OTP_REQUIRED');
      await db.query("UPDATE login_trusted_browsers SET expires_at=NOW()+INTERVAL '1 day' WHERE id=$1", [trustedBrowserId]);
      const issued = await login('resident', { trustedBrowserId });
      await db.query('UPDATE users SET auth_version=auth_version+1 WHERE id=1');
      assert.equal((await verify(issued.data.challengeId, { signature: await browser.sign(issued.data.challengeId) })).status, 400);
      assert.equal((await login('resident', { trustedBrowserId })).data.code, 'LOGIN_OTP_REQUIRED');
    });

    await t.test('resending replaces the code with a cooldown and wrong guesses have a durable limit', async () => {
      const { data } = await login('admin');
      const { challengeId } = data;
      const originalCode = getCode();
      assert.equal((await request('/login/resend', { challengeId })).status, 429);
      await db.query("UPDATE login_challenges SET sent_at=NOW()-INTERVAL '61 seconds' WHERE id=$1", [challengeId]);
      assert.equal((await request('/login/resend', { challengeId })).status, 200);
      const newCode = getCode();
      assert.notEqual(newCode, originalCode);
      for (let attempt = 1; attempt <= 5; attempt++) {
        assert.equal((await verify(challengeId, { otp: originalCode })).status, attempt < 5 ? 400 : 429);
      }
      assert.equal((await verify(challengeId, { otp: newCode })).status, 429);

      const next = await login('admin');
      const nextCode = getCode();
      await db.query("UPDATE login_challenges SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [next.data.challengeId]);
      assert.equal((await verify(next.data.challengeId, { otp: nextCode })).data.code, 'LOGIN_CHALLENGE_EXPIRED');
    });

    await t.test('temporary recovery applies only to the named Admin with a valid password', async () => {
      process.env.LOGIN_OTP_RECOVERY_ADMIN_EMAIL = 'admin@example.invalid';
      const sent = messages.length;
      assert.equal((await login('admin', { password: 'wrong' })).status, 401);
      const recovered = await login('admin');
      assert.equal(recovered.status, 200);
      assert.equal((await request('/me', null, recovered.data.token)).data.user.email, 'admin@example.invalid');
      assert.equal(messages.length, sent);
      assert.equal((await login('resident')).data.code, 'LOGIN_OTP_REQUIRED');

      process.env.LOGIN_OTP_RECOVERY_ADMIN_EMAIL = 'resident@example.invalid';
      assert.equal((await login('resident')).data.code, 'LOGIN_OTP_REQUIRED');

      process.env.LOGIN_OTP_RECOVERY_ADMIN_EMAIL = 'admin@example.invalid';
      await db.query("UPDATE users SET email='new-admin@example.invalid', auth_version=auth_version+1 WHERE id=2");
      const updated = await login('new-admin');
      assert.equal(updated.status, 202);
      assert.equal(updated.data.code, 'LOGIN_OTP_REQUIRED');
      assert.equal(messages.at(-1).to, 'new-admin@example.invalid');
      await db.query("UPDATE users SET email='admin@example.invalid' WHERE id=2");
      process.env.LOGIN_OTP_RECOVERY_ADMIN_EMAIL = '';
    });

    await t.test('mail failure grants no access and rolls back the new challenge', async () => {
      const before = await row('SELECT COUNT(*)::int AS count FROM login_challenges');
      failMail = true;
      const result = await login('admin');
      assert.equal(result.status, 503);
      assert.equal(result.data.token, undefined);
      assert.equal(result.data.challengeId, undefined);
      assert.deepEqual(await row('SELECT COUNT(*)::int AS count FROM login_challenges'), before);
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    pool.query = original.query;
    pool.connect = original.connect;
    nodemailer.createTransport = original.transport;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await db.close();
  }
});
