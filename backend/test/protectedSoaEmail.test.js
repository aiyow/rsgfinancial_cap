import test from 'node:test';
import assert from 'node:assert/strict';
import { createProtectedSoaMailer, protectedSmtpOptions } from '../services/protectedSoaEmail.js';
import { soaFingerprint } from '../services/protectedSoaSource.js';
const environment = { SMTP_HOST: 'smtp.example.invalid', SMTP_PORT: '587', SMTP_USER: 'fixture', SMTP_PASSWORD: 'fixture', SMTP_FROM: 'Condo <condo@example.invalid>' };

test('password delivery requires authenticated verified TLS and contains no attachment or balances', async () => {
  let sent, options, closed = 0;
  const service = createProtectedSoaMailer({ environment, createTransport(opts) { options = opts; return {
    async verify() {}, async sendMail(message) { sent = message; return { accepted: ['resident@example.invalid'] }; }, close() { closed++; },
  }; } });
  await service.verify();
  await service.send({ email: 'resident@example.invalid', password: 'fixture-only', reference: 'SX-ABC', unitNumber: '234', periodStart: '2026-10-05', periodEnd: '2026-11-05' });
  assert.equal(options.requireTLS, true); assert.equal(options.tls.rejectUnauthorized, true); assert.equal(options.tls.minVersion, 'TLSv1.2');
  assert.equal(options.debug, false); assert.equal(options.logger, false); assert.equal(closed, 2);
  assert.equal(sent.attachments, undefined); assert.equal(sent.html, undefined); assert.match(sent.text, /SOA-SX-ABC.pdf/);
  assert.match(sent.text, /fixture-only/); assert.ok(!/balance|₱/.test(sent.text));
  assert.equal(protectedSmtpOptions({ ...environment, SMTP_SECURE: 'true', SMTP_PORT: '465' }).secure, true);
  assert.throws(() => protectedSmtpOptions({}), /CONFIGURATION/);
});
test('rejected, uncertain, and timed-out SMTP outcomes are generic failures', async () => {
  for (const outcome of [{ accepted: [] }, { accepted: ['other@example.invalid'] }, { accepted: ['resident@example.invalid'], rejected: ['resident@example.invalid'] }, new Error('raw SMTP contents and secrets')]) {
    const mailer = createProtectedSoaMailer({ environment, createTransport: () => ({ async sendMail() { if (outcome instanceof Error) throw outcome; return outcome; }, close() {} }) });
    await assert.rejects(mailer.send({ email: 'resident@example.invalid' }), error => error.message === 'PASSWORD_EMAIL_FAILED');
  }
});
test('document fingerprints include corrections, publication identity, ledgers, dates and logo changes', () => {
  const bill = { id: 1, soaRevision: 1, publishedAt: new Date('2026-01-01T00:00Z'), soaTemplate: { accentColor: '#166534' }, chargePayments: { WATER: { approvedAmount: 5 } } };
  const fingerprint = soaFingerprint(bill, 'logo-one');
  assert.equal(soaFingerprint({ ...bill, emailDelivery: { pending: 1 }, payableBalance: 4 }, 'logo-one'), fingerprint);
  for (const patch of [{ soaRevision: 2 }, { publishedAt: new Date('2026-01-02T00:00Z') }, { totalAmount: 100 }, { statementDate: '2026-01-03' }, { chargePayments: { WATER: { approvedAmount: 10 } } }]) assert.notEqual(soaFingerprint({ ...bill, ...patch }, 'logo-one'), fingerprint);
  assert.notEqual(soaFingerprint(bill, 'logo-two'), fingerprint);
});
