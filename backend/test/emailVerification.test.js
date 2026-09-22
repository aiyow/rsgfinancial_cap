import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVerificationEmailMessage,
  createEmailVerificationService,
  hashVerificationToken,
  verificationExpiryDate,
} from "../services/emailVerification.js";

test("verification email uses a frontend verification link and escapes the recipient", () => {
  const message = buildVerificationEmailMessage({
    fullName: "Ava <Resident>", token: "safe-token", clientUrl: "https://condo.example/",
  });
  assert.equal(message.url, "https://condo.example/verify-email?token=safe-token");
  assert.match(message.html, /Ava &lt;Resident&gt;/);
  assert.match(message.text, /expires in 24 hours/);
});

test("verification email service uses the configured SMTP transport", async () => {
  const calls = { transport: [], mail: [] };
  const service = createEmailVerificationService({
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
  await service.sendVerificationEmail({ fullName: "Ava", email: "ava@example.com", token: "test-token" });
  assert.equal(calls.mail[0].to, "ava@example.com");
  assert.match(calls.mail[0].html, /verify-email\?token=test-token/);
});

test("tokens are stored as stable SHA-256 hashes and expire in 24 hours", () => {
  assert.equal(hashVerificationToken("test-token").length, 64);
  const now = new Date("2026-08-28T00:00:00.000Z");
  assert.equal(verificationExpiryDate(now).toISOString(), "2026-08-29T00:00:00.000Z");
});
