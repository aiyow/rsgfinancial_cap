import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPasswordResetEmailMessage,
  createPasswordResetService,
  createPasswordResetOtp,
  hashPasswordResetOtp,
  passwordResetOtpMatches,
  passwordResetExpiryDate,
} from "../services/passwords.js";

test("password-reset email contains a six-digit OTP and no reset link", () => {
  const message = buildPasswordResetEmailMessage({ fullName: "Ava <Resident>", otp: "012345" });
  assert.match(message.html, /Ava &lt;Resident&gt;/);
  assert.match(message.text, /012345/);
  assert.match(message.text, /expires in 10 minutes/);
  assert.doesNotMatch(message.html, /href|reset-password\?token/);
  const now = new Date("2026-09-29T00:00:00.000Z");
  assert.equal(passwordResetExpiryDate(now).toISOString(), "2026-09-29T00:10:00.000Z");
});

test("OTP hashes are secret-keyed and scoped to one recovery challenge", () => {
  const hash = hashPasswordResetOtp("challenge-a", "012345", "test-secret");
  assert.equal(hash.length, 64);
  assert.equal(passwordResetOtpMatches("challenge-a", "012345", hash, "test-secret"), true);
  assert.equal(passwordResetOtpMatches("challenge-b", "012345", hash, "test-secret"), false);
  assert.equal(passwordResetOtpMatches("challenge-a", "012346", hash, "test-secret"), false);
  assert.equal(passwordResetOtpMatches("challenge-a", "012345", hash, "different-secret"), false);
  for (let i = 0; i < 50; i++) assert.match(createPasswordResetOtp(), /^\d{6}$/);
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

  await service.sendPasswordResetEmail({ fullName: "Ava", email: "ava@example.com", otp: "012345" });
  assert.equal(calls.mail[0].to, "ava@example.com");
  assert.match(calls.mail[0].html, /012345/);
});
