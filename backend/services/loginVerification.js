import { createHmac, createPublicKey, randomInt, randomUUID, timingSafeEqual, verify } from 'node:crypto';
import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import { consumeAccountRequestQuota } from './accounts.js';
import { createEmailVerificationService } from './email.js';

export const LOGIN_CODE_MAX_ATTEMPTS = 5;
export const LOGIN_CODE_COOLDOWN_SECONDS = 60;

function hashLoginValue(...values) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured.');
  return createHmac('sha256', process.env.JWT_SECRET)
    .update(JSON.stringify(['login-verification', ...values])).digest('hex');
}

export function loginQuota(database, action, identity, limit, seconds) {
  return consumeAccountRequestQuota(database, hashLoginValue('quota', action, identity), limit, seconds,
    'Too many sign-in requests. Please try again later.');
}

export function loginCodeMatches(challenge, otp) {
  return timingSafeEqual(Buffer.from(challenge.otp_hash, 'hex'),
    Buffer.from(hashLoginValue('otp', challenge.id, otp), 'hex'));
}

export async function saveAndSendLoginCode(client, user, challengeId, previousHash) {
  await loginQuota(client, 'send-user', user.id, 6, 600);
  let otp, hash;
  do {
    otp = String(randomInt(1_000_000)).padStart(6, '0');
    hash = hashLoginValue('otp', challengeId, otp);
  } while (hash === previousHash);

  if (previousHash) {
    await client.query('UPDATE login_challenges SET otp_hash=$2, sent_at=NOW() WHERE id=$1', [challengeId, hash]);
  } else {
    await client.query(`INSERT INTO login_challenges(id,user_id,auth_version,otp_hash,expires_at)
      VALUES($1,$2,$3,$4,NOW()+INTERVAL '10 minutes')`, [challengeId, user.id, user.authVersion, hash]);
  }

  try {
    await createEmailVerificationService().sendLoginCode({ email: user.email, otp });
  } catch {
    throw Object.assign(new Error('We could not send your sign-in code. Please try again later.'), { status: 503 });
  }
}

export function parseTrustedBrowserKey(encodedKey) {
  try {
    const key = createPublicKey({ key: Buffer.from(encodedKey, 'base64url'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails.namedCurve === 'prime256v1') return key;
  } catch {
    // Invalid key material cannot enroll a trusted browser.
  }
  return null;
}

export function verifyTrustedBrowserProof(challengeId, publicKey, proof) {
  const key = parseTrustedBrowserKey(publicKey);
  return Boolean(key && verify('sha256', Buffer.from(`residens-trusted-browser:${challengeId}`),
    { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(proof, 'base64url')));
}

export async function enrollTrustedBrowser(client, user, key) {
  const id = randomUUID();
  const publicKey = key.export({ format: 'der', type: 'spki' }).toString('base64url');
  await client.query(`INSERT INTO login_trusted_browsers(id,user_id,auth_version,public_key,expires_at)
    VALUES($1,$2,$3,$4,NOW()+INTERVAL '360 hours')`, [id, user.id, user.authVersion, publicKey]);
  return id;
}

export function loginSession({ authVersion, ...user }) {
  const token = jwt.sign({ id: user.id, authVersion }, process.env.JWT_SECRET, { expiresIn: '8h' });
  return { message: 'Login successful.', token, user };
}

export function startLoginVerificationCleanup() {
  async function cleanup() {
    try {
      await pool.query('DELETE FROM login_challenges WHERE expires_at<=NOW()');
      await pool.query('DELETE FROM login_trusted_browsers WHERE expires_at<=NOW()');
    } catch (error) {
      console.error('Sign-in verification cleanup failed:', error.message);
    }
  }
  void cleanup();
  const timer = setInterval(cleanup, 15 * 60 * 1000);
  timer.unref();
}
