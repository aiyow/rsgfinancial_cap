import express from 'express';
import { randomUUID } from 'node:crypto';
import { verifyPassword } from "../services/passwords.js";
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import pool from '../config/db.js';
import { requireAuth, allowRoles } from '../middleware/authMiddleware.js';
import { validateBody } from '../middleware/validate.js';
import { writeAuditLog } from '../services/audit.js';
import { sendEmailChangeCode } from "../services/email.js";
import {
  createEmailChangeCode,
  emailChangeExpiry,
  hashEmailChangeCode,
  emailChangeCodeMatches,
  EMAIL_CHANGE_COOLDOWN_SECONDS,
  EMAIL_CHANGE_MAX_ATTEMPTS,
} from "../services/accounts.js";

const router = express.Router();
const userColumns = `id, full_name AS "fullName", email, role, is_active AS "isActive",
  approval_status AS "approvalStatus", email_verified AS "emailVerified", created_at AS "createdAt", updated_at AS "updatedAt"`;
const nameSchema = z.object({ fullName: z.string().trim().min(1).max(205) }).strict();
const emailSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  currentPassword: z.string().min(1).max(256),
}).strict();
const verifySchema = z.object({ challengeId: z.uuid(), otp: z.string().regex(/^\d{6}$/, 'Enter the six-digit code.') }).strict();

router.use(requireAuth, allowRoles('ADMIN', 'COLLECTOR'));

async function ensureEmailAvailable(client, email, userId) {
  const existing = await client.query('SELECT 1 FROM users WHERE LOWER(BTRIM(email)) = $1 AND id <> $2 LIMIT 1', [email, userId]);
  if (existing.rows[0]) throw Object.assign(new Error('That email address is already registered.'), { status: 409 });
}

router.patch('/profile', validateBody(nameSchema), async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const before = (await client.query(`SELECT ${userColumns} FROM users WHERE id=$1 FOR UPDATE`, [req.user.id])).rows[0];
    const result = await client.query(`UPDATE users SET full_name=$1 WHERE id=$2 RETURNING ${userColumns}`, [req.validatedBody.fullName, req.user.id]);
    await writeAuditLog({ client, actorUserId: req.user.id, entityName: 'USER_ACCOUNT', entityId: req.user.id,
      action: 'UPDATE_PROFILE', oldValues: { fullName: before.fullName }, newValues: { fullName: result.rows[0].fullName } });
    await client.query('COMMIT');
    return res.json({ message: 'Name updated.', user: result.rows[0] });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return next(error);
  } finally { client?.release(); }
});

router.post('/email-change', validateBody(emailSchema), async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { email, currentPassword } = req.validatedBody;
    const user = (await client.query(`SELECT ${userColumns}, password_hash AS "passwordHash", auth_version AS "authVersion"
      FROM users WHERE id=$1 FOR UPDATE`, [req.user.id])).rows[0];
    if (!user || !await verifyPassword(currentPassword, user.passwordHash)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Your current password is incorrect.' });
    }
    if (email === user.email.trim().toLowerCase()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Enter a different email address.' });
    }
    const pending = (await client.query('SELECT sent_at FROM email_change_challenges WHERE user_id=$1', [req.user.id])).rows[0];
    const retryAfterSeconds = pending ? Math.ceil(EMAIL_CHANGE_COOLDOWN_SECONDS - (Date.now() - new Date(pending.sent_at).getTime()) / 1000) : 0;
    if (retryAfterSeconds > 0) {
      await client.query('ROLLBACK');
      return res.status(429).json({ message: `Please wait ${retryAfterSeconds}s before requesting another code.`, retryAfterSeconds });
    }
    await ensureEmailAvailable(client, email, req.user.id);
    const challengeId = randomUUID();
    const otp = createEmailChangeCode();
    await client.query(`INSERT INTO email_change_challenges
      (id,user_id,original_email,new_email,auth_version,otp_hash,expires_at,sent_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,NOW())
      ON CONFLICT(user_id) DO UPDATE SET id=EXCLUDED.id, original_email=EXCLUDED.original_email,
        new_email=EXCLUDED.new_email, auth_version=EXCLUDED.auth_version, otp_hash=EXCLUDED.otp_hash,
        expires_at=EXCLUDED.expires_at, sent_at=NOW(), attempts=0`,
    [challengeId, req.user.id, user.email, email, user.authVersion, hashEmailChangeCode(challengeId, email, otp), emailChangeExpiry()]);
    try {
      await sendEmailChangeCode({ fullName: user.fullName, email, otp });
    } catch {
      throw Object.assign(new Error('We could not send the code. Please try again shortly.'), { status: 503 });
    }
    await client.query('COMMIT');
    return res.json({ message: 'Verification code sent.', challengeId, email, retryAfterSeconds: EMAIL_CHANGE_COOLDOWN_SECONDS });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return next(error);
  } finally { client?.release(); }
});

router.post('/email-change/verify', validateBody(verifySchema), async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const user = (await client.query('SELECT email, auth_version FROM users WHERE id=$1 FOR UPDATE', [req.user.id])).rows[0];
    const challenge = (await client.query(`SELECT *, expires_at > NOW() AS valid FROM email_change_challenges
      WHERE id=$1 AND user_id=$2 FOR UPDATE`, [req.validatedBody.challengeId, req.user.id])).rows[0];
    if (!user || !challenge || !challenge.valid || challenge.original_email !== user.email || challenge.auth_version !== user.auth_version) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'This code is invalid or has expired. Request a new code.' });
    }
    if (challenge.attempts >= EMAIL_CHANGE_MAX_ATTEMPTS) {
      await client.query('ROLLBACK');
      return res.status(429).json({ message: 'Too many incorrect attempts. Request a new code.' });
    }
    if (!emailChangeCodeMatches(challenge.id, challenge.new_email, req.validatedBody.otp, challenge.otp_hash)) {
      await client.query('UPDATE email_change_challenges SET attempts=attempts+1 WHERE id=$1', [challenge.id]);
      await client.query('COMMIT');
      const remaining = EMAIL_CHANGE_MAX_ATTEMPTS - challenge.attempts - 1;
      return res.status(remaining ? 400 : 429).json({ message: remaining
        ? `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
        : 'Too many incorrect attempts. Request a new code.' });
    }
    await ensureEmailAvailable(client, challenge.new_email, req.user.id);
    const updated = (await client.query(`UPDATE users SET email=$1, email_verified=TRUE,
      email_verification_token_hash=NULL, email_verification_expires_at=NULL,
      password_reset_token_hash=NULL, password_reset_expires_at=NULL, password_reset_last_sent_at=NULL,
      auth_version=auth_version+1 WHERE id=$2 RETURNING ${userColumns}, auth_version AS "authVersion"`,
    [challenge.new_email, req.user.id])).rows[0];
    await client.query('DELETE FROM email_change_challenges WHERE user_id=$1', [req.user.id]);
    await client.query('DELETE FROM password_reset_challenges WHERE user_id=$1', [req.user.id]);
    await writeAuditLog({ client, actorUserId: req.user.id, entityName: 'USER_ACCOUNT', entityId: req.user.id,
      action: 'CHANGE_EMAIL', oldValues: { email: user.email }, newValues: { email: updated.email },
      remarks: 'Account owner verified the new email address with a single-use code.' });
    const token = jwt.sign({ id: req.user.id, authVersion: updated.authVersion }, process.env.JWT_SECRET, { expiresIn: '8h' });
    delete updated.authVersion;
    await client.query('COMMIT');
    res.set('Cache-Control', 'no-store');
    return res.json({ message: 'Email address updated.', user: updated, token });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return next(error);
  } finally { client?.release(); }
});

export default router;
