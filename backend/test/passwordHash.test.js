import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcrypt';
import { hashPassword, verifyPassword } from '../services/passwordHash.js';

test('new hashes verify the complete 128-character password without a 72-byte cutoff', async () => {
  const password = 'Maple7!xyZab'.padEnd(128, 'x');
  const hash = await hashPassword(password);
  assert.match(hash, /^scrypt-v1\$/);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword(password.slice(0, 127) + 'y', hash), false);
  assert.equal(await verifyPassword(password.slice(0, 72), hash), false);
});

test('long Unicode passwords, spaces, and salts are retained exactly', async () => {
  const password = ' Aa1!' + '😀'.repeat(122) + ' ';
  assert.equal(Array.from(password).length, 128);
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword(password.trim(), first), false);
});

test('legacy bcrypt credentials continue working without password resets', async () => {
  const hash = await bcrypt.hash('old12345', 4);
  assert.equal(await verifyPassword('old12345', hash), true);
  assert.equal(await verifyPassword('wrong123', hash), false);
});

test('unknown or malformed stored hash formats fail closed', async () => {
  for (const hash of ['', 'plain text', 'scrypt-v2$invalid', 'scrypt-v1$invalid', null]) {
    assert.equal(await verifyPassword('Maple7!xyZab', hash), false);
  }
});
