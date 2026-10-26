import crypto from "node:crypto";
import nodemailer from "nodemailer";

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
    text: `${recipient}\n\nVerify your email address for your RSG Condo Water Billing account.\n\nVerify email: ${url}\n\nThis link expires in 24 hours. If you did not create this account, you can ignore this email.`,
    html: `<p>${escapeHtml(recipient)}</p><p>Verify your email address for your <strong>RSG Condo Water Billing</strong> account.</p><p><a href="${escapeHtml(url)}">Verify email address</a></p><p>This link expires in 24 hours. If you did not create this account, you can ignore this email.</p>`,
    url,
  };
}

export function buildEmailChangeMessage({ fullName, otp }) {
  const recipient = fullName ? `Hello ${fullName},` : 'Hello,';
  return {
    subject: 'Verify your new The ResiDens email address',
    text: `${recipient}\n\nYour email change code is: ${otp}\n\nEnter this code in Settings to confirm your new email address. It expires in 10 minutes. Your current email stays unchanged until verification. Never share this code. If you did not request this change, ignore this email.`,
    html: `<p>${escapeHtml(recipient)}</p><p>Enter this code in <strong>Settings</strong> to confirm your new email address:</p><p style="font-size:32px;font-weight:bold;letter-spacing:8px">${escapeHtml(otp)}</p><p>This code expires in 10 minutes. Your current email stays unchanged until verification. Never share this code. If you did not request this change, ignore this email.</p>`,
  };
}

export function createEmailVerificationService({
  environment = process.env,
  createTransport = nodemailer.createTransport,
} = {}) {
  return {
    async sendRegistrationCode({ email, otp }) {
      const config = emailConfiguration(environment);
      const transporter = createTransport({ host:config.host,port:config.port,secure:config.secure,auth:config.auth,
        connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000 });
      await transporter.sendMail({ from:config.from,to:email,subject:'Your The ResiDens registration code',
        text:`Your registration code is: ${otp}\n\nEnter this code to verify your email before creating an account. It expires in 10 minutes and can only be used once. Never share it. If you did not request this, ignore this email.`,
        html:`<p>Your The ResiDens registration code:</p><p style="font-size:32px;font-weight:bold;letter-spacing:8px">${escapeHtml(otp)}</p><p>It expires in 10 minutes and can only be used once. Never share it. If you did not request this, ignore this email.</p>` });
    },
    async sendEmailChangeCode({ fullName, email, otp }) {
      const message = buildEmailChangeMessage({ fullName, otp });
      const config = emailConfiguration(environment);
      const transporter = createTransport({ host: config.host, port: config.port, secure: config.secure, auth: config.auth });
      await transporter.sendMail({ from: config.from, to: email, subject: message.subject, text: message.text, html: message.html });
      return message;
    },
    async sendVerificationEmail({ fullName, email, token }) {
      const message = buildVerificationEmailMessage({ fullName, token, clientUrl: environment.CLIENT_URL });
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

export async function sendEmailChangeCode(delivery) {
  return createEmailVerificationService().sendEmailChangeCode(delivery);
}

export async function sendRegistrationCode(delivery) {
  return createEmailVerificationService().sendRegistrationCode(delivery);
}
