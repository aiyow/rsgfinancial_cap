import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPasswordResetEmailMessage,
  createPasswordResetService,
  hashPasswordResetToken,
  passwordResetExpiryDate,
} from "../services/passwordReset.js";

test("password-reset email uses a secure frontend link and expires after one hour", () => {
  const message = buildPasswordResetEmailMessage({ fullName: "Ava <Resident>", token: "safe-token", clientUrl: "https://condo.example/" });
  assert.equal(message.url, "https://condo.example/reset-password?token=safe-token");
  assert.match(message.html, /Ava &lt;Resident&gt;/);
  assert.match(message.text, /expires in 1 hour/);
  assert.equal(hashPasswordResetToken("safe-token").length, 64);
  const now = new Date("2026-09-29T00:00:00.000Z");
  assert.equal(passwordResetExpiryDate(now).toISOString(), "2026-09-29T01:00:00.000Z");
});

test("password-reset email service uses the configured SMTP transport", async () => {
  const calls = { transport: [], mail: [] };
  const service = createPasswordResetService({
    environment: {
      SMTP_HOST: "smtp.gmail.com", SMTP_PORT: "465", SMTP_SECURE: "true",
      SMTP_USER: "billing@example.com", SMTP_PASSWORD: "app-password", SMTP_FROM: "Condo <billing@example.com>",
      CLIENT_URL: "https://condo.example",
    },
    createTransport(options) {
      calls.transport.push(options);
      return { async sendMail(message) { calls.mail.push(message); } };
    },
  });

  await service.sendPasswordResetEmail({ fullName: "Ava", email: "ava@example.com", token: "test-token" });
  assert.equal(calls.mail[0].to, "ava@example.com");
  assert.match(calls.mail[0].html, /reset-password\?token=test-token/);
});
