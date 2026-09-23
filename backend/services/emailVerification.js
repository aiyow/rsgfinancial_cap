import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { Resend } from "resend";

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

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

function resendConfiguration(environment) {
  const apiKey = String(environment.RESEND_API_KEY || "").trim();
  if (!apiKey) return null;

  const from = String(environment.RESEND_FROM || "").trim();
  if (!from) {
    const error = new Error("RESEND_FROM is required when RESEND_API_KEY is configured.");
    error.code = "EMAIL_NOT_CONFIGURED";
    throw error;
  }

  return { apiKey, from };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

export function createVerificationToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashVerificationToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

export function verificationExpiryDate(now = new Date()) {
  return new Date(now.getTime() + VERIFICATION_TTL_MS);
}

export function buildVerificationEmailMessage({ fullName, token, clientUrl }) {
  const url = `${String(clientUrl || "http://localhost:5173").replace(/\/$/, "")}/verify-email?token=${encodeURIComponent(token)}`;
  const recipient = fullName ? `Hello ${fullName},` : "Hello,";
  return {
    subject: "Verify your RSG Condo account",
    text: `${recipient}\n\nVerify your email address to activate your RSG Condo Water Billing account.\n\nVerify email: ${url}\n\nThis link expires in 24 hours. If you did not create this account, you can ignore this email.`,
    html: `<p>${escapeHtml(recipient)}</p><p>Verify your email address to activate your <strong>RSG Condo Water Billing</strong> account.</p><p><a href="${escapeHtml(url)}">Verify email address</a></p><p>This link expires in 24 hours. If you did not create this account, you can ignore this email.</p>`,
    url,
  };
}

export function createEmailVerificationService({
  environment = process.env,
  createTransport = nodemailer.createTransport,
  createResend = (apiKey) => new Resend(apiKey),
} = {}) {
  return {
    async sendVerificationEmail({ fullName, email, token }) {
      const message = buildVerificationEmailMessage({ fullName, token, clientUrl: environment.CLIENT_URL });
      const resend = resendConfiguration(environment);
      if (resend) {
        const result = await createResend(resend.apiKey).emails.send({
          from: resend.from,
          to: email,
          subject: message.subject,
          text: message.text,
          html: message.html,
        });
        if (result.error) {
          const error = new Error(result.error.message || "Resend could not send the verification email.");
          error.code = "EMAIL_DELIVERY_FAILED";
          throw error;
        }
        return message;
      }

      const config = emailConfiguration(environment);
      const transporter = createTransport({ host: config.host, port: config.port, secure: config.secure, auth: config.auth });
      await transporter.sendMail({ from: config.from, to: email, subject: message.subject, text: message.text, html: message.html });
      return message;
    },
  };
}

export async function sendVerificationEmail(delivery) {
  return createEmailVerificationService().sendVerificationEmail(delivery);
}
