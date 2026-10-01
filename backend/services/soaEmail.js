import nodemailer from "nodemailer";

function smtpConfiguration(environment) {
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

function money(value) {
  return `PHP ${Number(value || 0).toFixed(2)}`;
}

function billUrl(clientUrl, billId) {
  return `${String(clientUrl || "http://localhost:5173").replace(/\/$/, "")}/resident/bills/${billId}`;
}

export function buildSoaEmailMessage({ delivery, clientUrl }) {
  const url = billUrl(clientUrl, delivery.billId);
  const recipient = delivery.recipientName ? `Hello ${delivery.recipientName},` : "Hello,";
  const subject = `Statement of Account available — Unit ${delivery.unitNumber}`;
  const text = `${recipient}\n\nYour Statement of Account for Unit ${delivery.unitNumber} is now available.\n`
    + `Billing period: ${delivery.periodStart} to ${delivery.periodEnd}\n`
    + `Due date: ${delivery.dueDate}\nRemaining balance: ${money(delivery.remainingBalance)}\n\n`
    + `Sign in to view your SOA: ${url}`;
  const html = `<p>${escapeHtml(recipient)}</p><p>Your <strong>Statement of Account</strong> for Unit ${escapeHtml(delivery.unitNumber)} is now available.</p>`
    + `<ul><li>Billing period: ${escapeHtml(delivery.periodStart)} to ${escapeHtml(delivery.periodEnd)}</li>`
    + `<li>Due date: ${escapeHtml(delivery.dueDate)}</li><li>Remaining balance: ${escapeHtml(money(delivery.remainingBalance))}</li></ul>`
    + `<p><a href="${escapeHtml(url)}">Sign in to view your SOA</a></p>`;
  return { subject, text, html, url };
}

const REMINDER_COPY = {
  DUE_SOON: {
    subject: "SOA payment reminder",
    intro: "Your Statement of Account payment is coming due soon.",
  },
  DUE_TODAY: {
    subject: "SOA payment due today",
    intro: "Your Statement of Account payment is due today.",
  },
  OVERDUE: {
    subject: "SOA payment overdue",
    intro: "Your Statement of Account payment is overdue.",
  },
};

export function buildSoaReminderEmailMessage({ delivery, reminderType, clientUrl }) {
  const copy = REMINDER_COPY[reminderType];
  if (!copy) throw new Error("Unknown SOA reminder type.");

  const url = billUrl(clientUrl, delivery.billId);
  const recipient = delivery.recipientName ? `Hello ${delivery.recipientName},` : "Hello,";
  const latePenalty = Number(delivery.latePenaltyAmount || 0);
  const penaltyText = latePenalty > 0 ? `\nLate penalty included: ${money(latePenalty)}` : "";
  const penaltyHtml = latePenalty > 0
    ? `<li>Late penalty included: ${escapeHtml(money(latePenalty))}</li>`
    : "";
  const subject = `${copy.subject} — Unit ${delivery.unitNumber}`;
  const text = `${recipient}\n\n${copy.intro}\n`
    + `Billing period: ${delivery.periodStart} to ${delivery.periodEnd}\n`
    + `Due date: ${delivery.dueDate}\nRemaining balance: ${money(delivery.remainingBalance)}${penaltyText}\n\n`
    + `Sign in to view and pay your SOA: ${url}`;
  const html = `<p>${escapeHtml(recipient)}</p><p>${escapeHtml(copy.intro)}</p>`
    + `<p>Your <strong>Statement of Account</strong> for Unit ${escapeHtml(delivery.unitNumber)}:</p>`
    + `<ul><li>Billing period: ${escapeHtml(delivery.periodStart)} to ${escapeHtml(delivery.periodEnd)}</li>`
    + `<li>Due date: ${escapeHtml(delivery.dueDate)}</li><li>Remaining balance: ${escapeHtml(money(delivery.remainingBalance))}</li>${penaltyHtml}</ul>`
    + `<p><a href="${escapeHtml(url)}">Sign in to view and pay your SOA</a></p>`;
  return { subject, text, html, url };
}

export function createSoaEmailService({
  environment = process.env,
  createTransport = nodemailer.createTransport,
} = {}) {
  return {
    async sendSoaNotification(delivery) {
      const message = buildSoaEmailMessage({ delivery, clientUrl: environment.CLIENT_URL });
      const smtp = smtpConfiguration(environment);
      const transporter = createTransport({ host: smtp.host, port: smtp.port, secure: smtp.secure, auth: smtp.auth });
      await transporter.sendMail({ from: smtp.from, to: delivery.recipientEmail, subject: message.subject, text: message.text, html: message.html });
      return message;
    },
    async sendSoaReminder(delivery, reminderType) {
      const message = buildSoaReminderEmailMessage({ delivery, reminderType, clientUrl: environment.CLIENT_URL });
      const smtp = smtpConfiguration(environment);
      const transporter = createTransport({ host: smtp.host, port: smtp.port, secure: smtp.secure, auth: smtp.auth });
      await transporter.sendMail({ from: smtp.from, to: delivery.recipientEmail, subject: message.subject, text: message.text, html: message.html });
      return message;
    },
  };
}

export async function sendSoaNotification(delivery) {
  return createSoaEmailService().sendSoaNotification(delivery);
}

export async function sendSoaReminder(delivery, reminderType) {
  return createSoaEmailService().sendSoaReminder(delivery, reminderType);
}
