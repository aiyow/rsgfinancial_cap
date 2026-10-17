import crypto from 'node:crypto';

export const EMAIL_CHANGE_COOLDOWN_SECONDS = 60;
export const EMAIL_CHANGE_MAX_ATTEMPTS = 5;
export const emailChangeExpiry = (now = new Date()) => new Date(now.getTime() + 10 * 60 * 1000);
export const createEmailChangeCode = () => crypto.randomInt(0, 1000000).toString().padStart(6, '0');

export function hashEmailChangeCode(challengeId, email, code, secret = process.env.JWT_SECRET) {
  if (!secret) throw new Error('JWT_SECRET is not configured.');
  return crypto.createHmac('sha256', secret).update(`email-change:${challengeId}:${email}:${code}`).digest('hex');
}

export function emailChangeCodeMatches(challengeId, email, code, hash) {
  const expected = Buffer.from(hash || '', 'hex');
  const actual = Buffer.from(hashEmailChangeCode(challengeId, email, code), 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
