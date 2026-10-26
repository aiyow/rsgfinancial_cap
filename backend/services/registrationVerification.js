import crypto from 'node:crypto';
import pool from '../config/db.js';

export const REGISTRATION_TTL_MS = 10 * 60 * 1000;
export const REGISTRATION_MAX_ATTEMPTS = 5;
export const REGISTRATION_COOLDOWN_SECONDS = 60;
export const createRegistrationOtp = () => crypto.randomInt(0, 1000000).toString().padStart(6, '0');
export const createRegistrationToken = () => crypto.randomBytes(32).toString('base64url');
export const registrationExpiry = () => new Date(Date.now() + REGISTRATION_TTL_MS);
export function registrationHash(purpose, ...values) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured.');
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update(JSON.stringify(['registration', purpose, ...values])).digest('hex');
}
export function registrationOtpMatches(challenge, email, otp) {
  const actual = Buffer.from(registrationHash('otp', challenge.id, email, otp), 'hex');
  const expected = Buffer.from(challenge.otp_hash || '', 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
export const lockRegistrationEmail = (client, email) => client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ['registration:'+email]);

export async function consumeRegistrationGrant(client, email, token) {
  await lockRegistrationEmail(client, email);
  const result = await client.query(`SELECT email FROM registration_challenges
    WHERE email=$1 AND verified_token_hash=$2 AND expires_at>NOW() FOR UPDATE`, [email, registrationHash('grant', email, token)]);
  if (!result.rowCount) throw Object.assign(new Error('Verify your email before creating an account. Your verification may have expired.'), { status: 403 });
  // Deleted in the same transaction as account creation; rollback restores the grant.
  await client.query('DELETE FROM registration_challenges WHERE email=$1', [email]);
}

export async function registrationQuota(database, action, identity, limit, seconds) {
  const result = await database.query(`INSERT INTO registration_rate_limits(key_hash,expires_at)
    VALUES($1,NOW()+make_interval(secs=>$2)) ON CONFLICT(key_hash) DO UPDATE SET
    request_count=CASE WHEN registration_rate_limits.expires_at<=NOW() THEN 1 ELSE LEAST(registration_rate_limits.request_count+1,1000000) END,
    window_started_at=CASE WHEN registration_rate_limits.expires_at<=NOW() THEN NOW() ELSE registration_rate_limits.window_started_at END,
    expires_at=CASE WHEN registration_rate_limits.expires_at<=NOW() THEN NOW()+make_interval(secs=>$2) ELSE registration_rate_limits.expires_at END
    RETURNING request_count, GREATEST(1,CEIL(EXTRACT(EPOCH FROM expires_at-NOW())))::int AS retry`, [registrationHash('quota', action, identity), seconds]);
  const row = result.rows[0];
  if (row.request_count > limit) throw Object.assign(new Error('Too many registration requests. Please try again later.'), { status: 429, retryAfterSeconds: row.retry });
  return row.request_count;
}

export async function cleanupRegistrationData(database = pool) {
  await database.query('DELETE FROM registration_challenges WHERE expires_at<=NOW()');
  await database.query('DELETE FROM registration_rate_limits WHERE expires_at<=NOW()');
}
export function startRegistrationCleanup() {
  const run = () => cleanupRegistrationData().catch(error => console.error('Registration cleanup failed:', error.message));
  void run();
  const timer = setInterval(run, 15 * 60 * 1000);
  timer.unref();
}
