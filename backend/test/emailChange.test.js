import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEmailChangeMessage, createEmailVerificationService } from "../services/email.js";
import { createEmailChangeCode, emailChangeExpiry, hashEmailChangeCode } from "../services/accounts.js";

test('email change codes are bound to their challenge, recipient and secret', () => {
  const hash = hashEmailChangeCode('request-a', 'new@example.com', '012345', 'test-secret');
  assert.equal(hash.length, 64);
  assert.notEqual(hash, hashEmailChangeCode('request-b', 'new@example.com', '012345', 'test-secret'));
  assert.notEqual(hash, hashEmailChangeCode('request-a', 'other@example.com', '012345', 'test-secret'));
  assert.notEqual(hash, hashEmailChangeCode('request-a', 'new@example.com', '012345', 'other-secret'));
  assert.match(createEmailChangeCode(), /^\d{6}$/);
  assert.equal(emailChangeExpiry(new Date('2026-10-17T00:00:00Z')).toISOString(), '2026-10-17T00:10:00.000Z');
});

test('email changes send a code to the new address and explain that the old one stays active', async () => {
  const message = buildEmailChangeMessage({ fullName: 'Staff <Admin>', otp: '012345' });
  assert.match(message.html, /Staff &lt;Admin&gt;/);
  assert.match(message.text, /012345/);
  assert.match(message.text, /10 minutes/);
  assert.match(message.text, /current email stays unchanged/);
  const deliveries = [];
  const service = createEmailVerificationService({
    environment: { SMTP_HOST: 'smtp.example.com', SMTP_USER: 'staff', SMTP_PASSWORD: 'test', SMTP_FROM: 'staff@example.com' },
    createTransport: () => ({ async sendMail(delivery) { deliveries.push(delivery); } }),
  });
  await service.sendEmailChangeCode({ fullName: 'Staff', email: 'new@example.com', otp: '012345' });
  assert.equal(deliveries[0].to, 'new@example.com');
  assert.match(deliveries[0].text, /012345/);
});
