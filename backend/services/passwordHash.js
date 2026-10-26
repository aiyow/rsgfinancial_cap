import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import bcrypt from 'bcrypt';

const derive = promisify(scrypt);
// OWASP scrypt profile: N=2^14, r=8, p=5 (16 MiB, suitable for this service).
const options = { N: 16384, r: 8, p: 5, maxmem: 64 * 1024 * 1024 };
const prefix = 'scrypt-v1';

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, 64, options);
  return `${prefix}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || typeof storedHash !== 'string') return false;
  if (/^\$2[aby]\$/.test(storedHash)) return bcrypt.compare(password, storedHash);
  const match = /^scrypt-v1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(storedHash);
  if (!match) return false;
  const key = await derive(password, Buffer.from(match[1], 'hex'), 64, options);
  return timingSafeEqual(key, Buffer.from(match[2], 'hex'));
}
