import crypto from "node:crypto";
import nodemailer from "nodemailer";

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

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

export function createPasswordResetToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashPasswordResetToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

export function passwordResetExpiryDate(now = new Date()) {
  return new Date(now.getTime() + PASSWORD_RESET_TTL_MS);
}

export function buildPasswordResetEmailMessage({ fullName, token, clientUrl }) {
  const url = `${String(clientUrl || "http://localhost:5173").replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
  const recipient = fullName ? `Hello ${fullName},` : "Hello,";
  return {
    subject: "Reset your The ResiDens password",
    text: `${recipient}\n\nWe received a request to reset your The ResiDens password.\n\nReset password: ${url}\n\nThis link expires in 1 hour. If you did not request a password reset, you can safely ignore this email.`,
    html: `<p>${escapeHtml(recipient)}</p><p>We received a request to reset your <strong>The ResiDens</strong> password.</p><p><a href="${escapeHtml(url)}">Reset your password</a></p><p>This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email.</p>`,
    url,
  };
}

export function createPasswordResetService({
  environment = process.env,
  createTransport = nodemailer.createTransport,
} = {}) {
  return {
    async sendPasswordResetEmail({ fullName, email, token }) {
      const message = buildPasswordResetEmailMessage({ fullName, token, clientUrl: environment.CLIENT_URL });
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
