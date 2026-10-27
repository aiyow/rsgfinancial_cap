import { z } from 'zod';
import crypto, { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import bcrypt from 'bcrypt';
import nodemailer from 'nodemailer';
import { emailCode, emailTemplate, escapeHtml } from './email.js';

// Passwords service. Fold the region sections to navigate related code.
// 1. Password policy
// 2. Password validation
// 3. Password hashing
// 4. Password recovery and reset emails

// #region Password policy

// Keep the browser and API copies identical: deployments have independent roots.
// Parity is covered by backend/test/passwordPolicy.test.js.
export const PASSWORD_MIN_CHARACTERS = 12;
export const PASSWORD_MAX_CHARACTERS = 128;

const rules = [
  {
    code: 'length',
    label: `Minimum of ${PASSWORD_MIN_CHARACTERS} characters`,
    message: `Use between ${PASSWORD_MIN_CHARACTERS} and ${PASSWORD_MAX_CHARACTERS} characters.`,
    test: password => {
      const length = Array.from(password).length;
      return length >= PASSWORD_MIN_CHARACTERS && length <= PASSWORD_MAX_CHARACTERS;
    },
  },
  {
    code: 'uppercase', label: 'At least 1 uppercase letter',
    message: 'Include at least 1 uppercase letter.',
    test: password => /\p{Lu}/u.test(password),
  },
  {
    code: 'lowercase', label: 'At least 1 lowercase letter',
    message: 'Include at least 1 lowercase letter.',
    test: password => /\p{Ll}/u.test(password),
  },
  {
    code: 'number', label: 'At least 1 number',
    message: 'Include at least 1 number (0–9).',
    test: password => /[0-9]/.test(password),
  },
  {
    code: 'symbol', label: 'At least 1 symbol',
    message: 'Include at least 1 symbol, such as !, @, or #. Spaces do not count as symbols.',
    test: password => /[\p{P}\p{S}]/u.test(password),
  },
];

// The checklist and API errors evaluate exactly the same five requirements.
export function passwordRequirements(password) {
  const value = typeof password === 'string' ? password : '';
  return rules.map(({ code, label, message, test }) => ({ code, label, message, passed: test(value) }));
}

export function passwordIssues(password) {
  return passwordRequirements(password)
    .filter(requirement => !requirement.passed)
    .map(({ code, message }) => ({ code, message }));
}

export function passwordError(password, confirmation) {
  return passwordIssues(password)[0]?.message
    || (confirmation !== undefined && password !== confirmation ? 'Password and confirmation do not match.' : '');
}

// #endregion

// #region Password validation

// Only for setting a NEW password. Existing credentials retain their login rules.
export const newPasswordSchema = z.string().superRefine((password, context) => {
  for (const issue of passwordIssues(password)) {
    context.addIssue({ code: 'custom', message: issue.message });
  }
});

// #endregion

// #region Password hashing

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

// #endregion

// #region Password recovery and reset emails

export const PASSWORD_RESET_TTL_MS = 10 * 60 * 1000;
export const PASSWORD_RESET_MAX_ATTEMPTS = 5;
export const PASSWORD_RESET_COOLDOWN_SECONDS = 60;

// Login and recovery must select the same account when legacy duplicates remain.
export const userIdentityOrderSql = `is_active DESC,
  (approval_status = 'APPROVED') DESC, created_at ASC, id ASC`;

function emailConfiguration(environment) {
  const missing = ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"]
    .filter((name) => !String(environment[name] || "").trim());
  if (missing.length) {
    const error = new Error(`Email service is not configured. Missing: ${missing.join(", ")}.`);
    error.code = "EMAIL_NOT_CONFIGURED";
    throw error;
  }

  const port = Number(environment.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    const error = new Error("SMTP_PORT must be a valid port number.");
    error.code = "EMAIL_NOT_CONFIGURED";
    throw error;
  }

  return {
    host: environment.SMTP_HOST.trim(),
    port,
    secure: String(environment.SMTP_SECURE || "").toLowerCase() === "true",
    auth: { user: environment.SMTP_USER.trim(), pass: environment.SMTP_PASSWORD },
    from: environment.SMTP_FROM.trim(),
  };
}

export function createPasswordResetOtp() {
  return crypto.randomInt(0, 1000000).toString().padStart(6, "0");
}

export function createPasswordResetToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashPasswordResetToken(token) {
  return crypto.createHash("sha256").update(`verified-otp-reset:${token}`).digest("hex");
}

export function hashPasswordResetOtp(challengeId, otp, secret = process.env.JWT_SECRET) {
  if (!secret) throw new Error("JWT_SECRET is not configured.");
  return crypto.createHmac("sha256", secret).update(`${challengeId}:${otp}`).digest("hex");
}

export function passwordResetOtpMatches(challengeId, otp, expectedHash, secret = process.env.JWT_SECRET) {
  const actual = Buffer.from(hashPasswordResetOtp(challengeId, otp, secret), "hex");
  const expected = Buffer.from(expectedHash || "", "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function passwordResetExpiryDate(now = new Date()) {
  return new Date(now.getTime() + PASSWORD_RESET_TTL_MS);
}

export function buildPasswordResetEmailMessage({ fullName, otp }) {
  const recipient = fullName ? `Hello ${fullName},` : "Hello,";
  return {
    subject: "Your The ResiDens password reset code",
    text: `${recipient}\n\nYour password reset code is: ${otp}\n\nEnter this code on The ResiDens website to set a new password. It expires in 10 minutes and can only be used once. Never share this code. If you did not request it, ignore this email.`,
    html: emailTemplate({ title: 'Reset your password', body: `<p style="margin:0 0 18px">${escapeHtml(recipient)}</p><p>Enter this code on <strong>The ResiDens</strong> website to set a new password:</p>${emailCode(otp, 'Your password reset code')}<p>This code expires in <strong>10 minutes</strong> and can only be used once.</p><p>Never share this code. If you did not request it, ignore this email.</p>` }),
  };
}

export function createPasswordResetService({
  environment = process.env,
  createTransport = nodemailer.createTransport,
} = {}) {
  return {
    async sendPasswordResetEmail({ fullName, email, otp }) {
      const message = buildPasswordResetEmailMessage({ fullName, otp });
      const config = emailConfiguration(environment);
      const transporter = createTransport({ host: config.host, port: config.port, secure: config.secure, auth: config.auth });
      await transporter.sendMail({ from: config.from, to: email, subject: message.subject, text: message.text, html: message.html });
      return message;
    },
  };
}

export async function sendPasswordResetEmail(delivery) {
  return createPasswordResetService().sendPasswordResetEmail(delivery);
}

// #endregion
