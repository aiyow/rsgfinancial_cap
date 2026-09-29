import assert from "node:assert/strict";
import test from "node:test";
import { buildSoaEmailMessage, createSoaEmailService } from "../services/soaEmail.js";

const delivery = {
  billId: 42,
  recipientName: "Ava <Owner>",
  recipientEmail: "ava@example.com",
  unitNumber: "1201",
  periodStart: "2026-07-01",
  periodEnd: "2026-07-31",
  dueDate: "2026-08-10",
  remainingBalance: 1234.5,
};

test("SOA email uses a secure dashboard link and escapes rendered fields", () => {
  const message = buildSoaEmailMessage({ delivery, clientUrl: "https://condo.example/" });
  assert.equal(message.url, "https://condo.example/resident/bills/42");
  assert.match(message.text, /PHP 1234\.50/);
  assert.match(message.html, /Ava &lt;Owner&gt;/);
  assert.match(message.html, /https:\/\/condo\.example\/resident\/bills\/42/);
});

test("SOA email service uses the configured generic SMTP transport", async () => {
  const calls = { transport: [], mail: [] };
  const service = createSoaEmailService({
    environment: {
      SMTP_HOST: "smtp.example.com", SMTP_PORT: "465", SMTP_SECURE: "true",
      SMTP_USER: "user", SMTP_PASSWORD: "password", SMTP_FROM: "Condo <billing@example.com>",
      CLIENT_URL: "https://condo.example",
    },
    createTransport(options) {
      calls.transport.push(options);
      return { async sendMail(message) { calls.mail.push(message); } };
    },
  });

  await service.sendSoaNotification(delivery);
  assert.deepEqual(calls.transport[0], {
    host: "smtp.example.com", port: 465, secure: true, auth: { user: "user", pass: "password" },
  });
  assert.equal(calls.mail[0].to, "ava@example.com");
});

test("SOA email service reports missing SMTP configuration", async () => {
  const service = createSoaEmailService({ environment: {} });
  await assert.rejects(() => service.sendSoaNotification(delivery), { code: "EMAIL_NOT_CONFIGURED" });
});
