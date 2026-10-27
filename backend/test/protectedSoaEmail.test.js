import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProtectedSoaEmailMessage,
  createProtectedSoaMailer,
  protectedSmtpOptions,
} from "../services/email.js";
import { createSoaPassword, soaPasswordLastName, soaFingerprint } from "../services/soa.js";

const environment = { SMTP_HOST: 'smtp.example.invalid', SMTP_PORT: '587', SMTP_USER: 'fixture', SMTP_PASSWORD: 'fixture', SMTP_FROM: 'Condo <condo@example.invalid>' };

const delivery = { email: 'resident@example.invalid', residentName: 'Tanjiro Kamado', password: 'kamado0042', reference: 'SX-ABC', unitNumber: '234', periodStart: '2026-10-05', periodEnd: '2026-11-05', dueDate: '2026-11-10', pdf: Buffer.from('%PDF encrypted fixture') };

test('SOA email requires authenticated verified TLS and attaches the protected PDF with resident details and opening instructions', async () => {
  let sent, options, closed = 0;
  const service = createProtectedSoaMailer({ environment, createTransport(opts) { options = opts; return {
    async verify() {}, async sendMail(message) { sent = message; return { accepted: ['resident@example.invalid'] }; }, close() { closed++; },
  }; } });
  await service.verify();
  await service.send(delivery);
  assert.equal(options.requireTLS, true); assert.equal(options.tls.rejectUnauthorized, true); assert.equal(options.tls.minVersion, 'TLSv1.2');
  assert.equal(options.debug, false); assert.equal(options.logger, false); assert.equal(closed, 2);
  assert.equal(sent.attachments.length, 1); assert.equal(sent.attachments[0].filename, 'SOA-SX-ABC.pdf');
  assert.deepEqual(sent.attachments[0].content, delivery.pdf); assert.equal(sent.attachments[0].contentType, 'application/pdf');
  assert.equal(sent.attachments[0].contentDisposition, 'attachment');
  for (const content of [sent.text, sent.html]) {
    for (const detail of ['Tanjiro Kamado', '234', 'October 5, 2026', 'November 5, 2026', 'November 10, 2026', 'SX-ABC', 'kamado0042', '0042']) assert.ok(content.includes(detail));
    assert.match(content, /Download the PDF attached to this email/); assert.match(content, /last name in lowercase/);
    assert.match(content, /Confidentiality notice/); assert.ok(!/signed-in resident portal|15 minutes|balance|₱/.test(content));
  }
  assert.equal(sent.disableFileAccess, true); assert.equal(sent.disableUrlAccess, true);
  assert.equal(sent.headers['Auto-Submitted'], 'auto-generated');
  assert.equal(sent.headers['X-Auto-Response-Suppress'], 'All');
  assert.equal(protectedSmtpOptions({ ...environment, SMTP_SECURE: 'true', SMTP_PORT: '465' }).secure, true);
  assert.throws(() => protectedSmtpOptions({}), /CONFIGURATION/);
});
test('rejected, uncertain, and timed-out SMTP outcomes are generic failures', async () => {
  for (const outcome of [{ accepted: [] }, { accepted: ['other@example.invalid'] }, { accepted: ['resident@example.invalid'], rejected: ['resident@example.invalid'] }, new Error('raw SMTP contents and secrets')]) {
    const mailer = createProtectedSoaMailer({ environment, createTransport: () => ({ async sendMail() { if (outcome instanceof Error) throw outcome; return outcome; }, close() {} }) });
    await assert.rejects(mailer.send(delivery), error => error.message === 'SOA_EMAIL_FAILED');
  }
});

test('missing PDF cannot send an email claiming an attachment, and resident fields are escaped in HTML', async () => {
  const mailer = createProtectedSoaMailer({ createTransport() { assert.fail('No transport should be opened without an attachment'); } });
  await assert.rejects(mailer.send({ ...delivery, pdf: undefined }), /SOA_EMAIL_FAILED/);
  const message = buildProtectedSoaEmailMessage({ ...delivery, residentName: 'Ava <Owner>', unitNumber: '<234>', companyName: 'Condo & Co' });
  assert.match(message.html, /Ava &lt;Owner&gt;/); assert.match(message.html, /&lt;234&gt;/); assert.match(message.html, /Condo &amp; Co/);
  assert.ok(!message.html.includes('<Owner>'));
});

test('document passwords use the resident surname plus exactly four cryptographically random decimal digits', () => {
  for (const [name, expected] of [['Tanjiro Kamado', 'kamado'], ['José Niño de la Peña', 'delapeña'], ['Jane Marie AB. De la Cruz Jr.', 'delacruz'], ["Ava O’Neil-Santos", 'o’neil-santos'], ['Maria Dela Rosa', 'delarosa']]) {
    assert.equal(soaPasswordLastName(name), expected);
    for (let n = 0; n < 20; n++) {
      const password = createSoaPassword(name);
      assert.equal(password.slice(0, -4), expected); assert.match(password.slice(-4), /^\d{4}$/);
    }
  }
  assert.throws(() => createSoaPassword(''), /SOA_RESIDENT_NAME_REQUIRED/);
});
test('document fingerprints include corrections, publication identity, ledgers, dates and logo changes', () => {
  const bill = { id: 1, soaRevision: 1, publishedAt: new Date('2026-01-01T00:00Z'), soaTemplate: { accentColor: '#166534' }, chargePayments: { WATER: { approvedAmount: 5 } } };
  const fingerprint = soaFingerprint(bill, 'logo-one');
  assert.equal(soaFingerprint({ ...bill, emailDelivery: { pending: 1 }, payableBalance: 4 }, 'logo-one'), fingerprint);
  for (const patch of [{ soaRevision: 2 }, { publishedAt: new Date('2026-01-02T00:00Z') }, { totalAmount: 100 }, { statementDate: '2026-01-03' }, { chargePayments: { WATER: { approvedAmount: 10 } } }]) assert.notEqual(soaFingerprint({ ...bill, ...patch }, 'logo-one'), fingerprint);
  assert.notEqual(soaFingerprint(bill, 'logo-two'), fingerprint);
});
