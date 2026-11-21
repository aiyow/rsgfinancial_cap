import express from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import pool from '../config/db.js';
import { validateBody } from '../middleware/validate.js';
import { authUserColumns, normalizeEmailIdentity } from '../services/accounts.js';
import { userIdentityOrderSql, verifyPassword } from '../services/passwords.js';
import {
  enrollTrustedBrowser, loginCodeMatches, loginQuota, loginSession, parseTrustedBrowserKey,
  saveAndSendLoginCode, verifyTrustedBrowserProof, LOGIN_CODE_COOLDOWN_SECONDS, LOGIN_CODE_MAX_ATTEMPTS,
} from '../services/loginVerification.js';

const router = express.Router();
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(1).max(256),
  trustedBrowserId: z.uuid().optional(),
}).strict();
const challengeSchema = z.object({ challengeId: z.uuid() }).strict();
const verifySchema = z.union([
  challengeSchema.extend({ otp: z.string().regex(/^\d{6}$/), publicKey: z.string().regex(/^[A-Za-z0-9_-]{122}$/).optional() }),
  challengeSchema.extend({ signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/) }),
]);
const userFields = `${authUserColumns}, auth_version AS "authVersion"`;
const invalidPassword = { message: 'Invalid email or password.' };
const expiredChallenge = {
  code: 'LOGIN_CHALLENGE_EXPIRED',
  message: 'Your sign-in request has expired. Start signing in again for a new code.',
};
const invalidBrowser = { code: 'LOGIN_BROWSER_UNAVAILABLE', message: 'Verify your browser with an email code.' };
const tooManyAttempts = {
  code: 'LOGIN_CODE_ATTEMPTS_EXCEEDED',
  message: 'Too many incorrect codes. Start signing in again for a new code.',
};

function accountStatus(user) {
  if (!user.isActive) return { message: 'This account has been deactivated.' };
  if (user.approvalStatus !== 'APPROVED') {
    return {
      code: 'ACCOUNT_APPROVAL_REQUIRED',
      message: 'Your account is awaiting Admin approval. You can sign in after approval.',
      email: user.email,
    };
  }
}

function signInRoute(schema, handler) {
  return [
    (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); },
    validateBody(schema),
    async (req, res, next) => {
      try {
        const [status, body] = await handler(req);
        if (status === 429 && body.retryAfterSeconds) res.set('Retry-After', String(body.retryAfterSeconds));
        return res.status(status).json(body);
      } catch (error) {
        if (error.retryAfterSeconds) {
          res.set('Retry-After', String(error.retryAfterSeconds));
          return res.status(429).json({ message: error.message, retryAfterSeconds: error.retryAfterSeconds });
        }
        return next(error);
      }
    },
  ];
}

async function transaction(run) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function withChallenge(challengeId, run) {
  return transaction(async client => {
    const user = (await client.query(`SELECT ${userFields} FROM users
      WHERE id=(SELECT user_id FROM login_challenges WHERE id=$1) FOR UPDATE`, [challengeId])).rows[0];
    if (!user || accountStatus(user)) return [400, expiredChallenge];
    const challenge = (await client.query(`SELECT id,otp_hash,attempts,trusted_browser_id,
        GREATEST(0,CEIL(EXTRACT(EPOCH FROM sent_at+make_interval(secs=>$4)-NOW())))::int AS cooldown
      FROM login_challenges WHERE id=$1 AND user_id=$2 AND auth_version=$3 AND expires_at>NOW() FOR UPDATE`,
    [challengeId, user.id, user.authVersion, LOGIN_CODE_COOLDOWN_SECONDS])).rows[0];
    if (!challenge) return [400, expiredChallenge];
    return run(client, user, challenge);
  });
}

router.post('/login', ...signInRoute(loginSchema, async req => {
  const { email, password, trustedBrowserId } = req.validatedBody;
  await loginQuota(pool, 'password', [req.ip, email], 30, 900);
  const credential = (await pool.query(`SELECT id,auth_version AS "authVersion",password_hash AS "passwordHash"
    FROM users WHERE LOWER(BTRIM(email))=$1 ORDER BY ${userIdentityOrderSql} LIMIT 1`, [email])).rows[0];
  if (!credential || !await verifyPassword(password, credential.passwordHash)) return [401, invalidPassword];

  return transaction(async client => {
    const user = (await client.query(`SELECT ${userFields} FROM users WHERE id=$1 FOR UPDATE`, [credential.id])).rows[0];
    if (!user || user.authVersion !== credential.authVersion) return [401, invalidPassword];
    const unavailable = accountStatus(user);
    if (unavailable) return [403, unavailable];

    const recoveryEmail = normalizeEmailIdentity(process.env.LOGIN_OTP_RECOVERY_ADMIN_EMAIL);
    if (recoveryEmail && user.role === 'ADMIN' && normalizeEmailIdentity(user.email) === recoveryEmail) {
      return [200, loginSession(user)];
    }

    const challengeId = randomUUID();
    if (trustedBrowserId) {
      const browser = await client.query(`SELECT id FROM login_trusted_browsers
        WHERE id=$1 AND user_id=$2 AND auth_version=$3 AND expires_at>NOW() FOR KEY SHARE`,
      [trustedBrowserId, user.id, user.authVersion]);
      if (browser.rowCount) {
        await client.query(`INSERT INTO login_challenges(id,user_id,auth_version,trusted_browser_id,expires_at)
          VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 minute')`, [challengeId, user.id, user.authVersion, trustedBrowserId]);
        return [202, { code: 'LOGIN_BROWSER_PROOF_REQUIRED', challengeId }];
      }
    }

    await saveAndSendLoginCode(client, user, challengeId);
    return [202, { code: 'LOGIN_OTP_REQUIRED', challengeId, retryAfterSeconds: LOGIN_CODE_COOLDOWN_SECONDS }];
  });
}));

router.post('/login/verify', ...signInRoute(verifySchema, async req => {
  const { challengeId, otp, publicKey, signature } = req.validatedBody;
  await loginQuota(pool, 'verify-ip', req.ip, 600, 900);
  const key = publicKey && parseTrustedBrowserKey(publicKey);
  if (publicKey && !key) return [400, { message: 'The trusted browser key is invalid.' }];

  return withChallenge(challengeId, async (client, user, challenge) => {
    let trustedBrowserId;
    if (signature) {
      if (!challenge.trusted_browser_id) return [409, invalidBrowser];
      const browser = (await client.query(`SELECT public_key FROM login_trusted_browsers
        WHERE id=$1 AND user_id=$2 AND auth_version=$3 AND expires_at>NOW()`,
      [challenge.trusted_browser_id, user.id, user.authVersion])).rows[0];
      if (!browser || !verifyTrustedBrowserProof(challengeId, browser.public_key, signature)) return [409, invalidBrowser];
    } else {
      if (!challenge.otp_hash) return [400, expiredChallenge];
      if (challenge.attempts >= LOGIN_CODE_MAX_ATTEMPTS) return [429, tooManyAttempts];
      if (!loginCodeMatches(challenge, otp)) {
        await client.query('UPDATE login_challenges SET attempts=attempts+1 WHERE id=$1', [challengeId]);
        return challenge.attempts + 1 >= LOGIN_CODE_MAX_ATTEMPTS
          ? [429, tooManyAttempts]
          : [400, { message: 'That sign-in code is incorrect. Try again.' }];
      }
      if (key) trustedBrowserId = await enrollTrustedBrowser(client, user, key);
    }

    await client.query('DELETE FROM login_challenges WHERE id=$1', [challengeId]);
    return [200, { ...loginSession(user), ...(trustedBrowserId && { trustedBrowserId }) }];
  });
}));

router.post('/login/resend', ...signInRoute(challengeSchema, async req => {
  const { challengeId } = req.validatedBody;
  await loginQuota(pool, 'resend-ip', req.ip, 120, 900);
  return withChallenge(challengeId, async (client, user, challenge) => {
    if (!challenge.otp_hash) return [400, expiredChallenge];
    if (challenge.attempts >= LOGIN_CODE_MAX_ATTEMPTS) return [429, tooManyAttempts];
    if (challenge.cooldown > 0) {
      return [429, { message: 'A code was just sent. Wait before requesting another.', retryAfterSeconds: challenge.cooldown }];
    }
    await saveAndSendLoginCode(client, user, challengeId, challenge.otp_hash);
    return [200, { message: 'A new sign-in code was sent.', retryAfterSeconds: LOGIN_CODE_COOLDOWN_SECONDS }];
  });
}));

export default router;
