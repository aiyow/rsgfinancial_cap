import crypto from "node:crypto";
import nodemailer from "nodemailer";

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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
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
    html: `<p>${escapeHtml(recipient)}</p><p>Enter this code on <strong>The ResiDens</strong> website to set a new password:</p><p style="font-size:32px;font-weight:bold;letter-spacing:8px">${escapeHtml(otp)}</p><p>This code expires in 10 minutes and can only be used once. Never share this code. If you did not request it, ignore this email.</p>`,
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
