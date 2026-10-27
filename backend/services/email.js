import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { saveDeliveryOutcomes } from './audit.js';
import pool from '../config/db.js';
import {
  billAppliedSql,
  billTotalSql,
  chargePaymentsSql,
  recipientPaymentDetails,
  applyDueLatePenalties,
} from './payments.js';
import cron from 'node-cron';

// Email service. Fold the region sections to navigate related code.
// 1. Shared email layout and formatting
// 2. Registration and account verification emails
// 3. SOA notifications and reminders
// 4. Protected SOA attachment emails
// 5. Publication email delivery
// 6. Reminder scheduling and deduplication

// #region Shared email layout and formatting

export const EMAIL_COMPANY_NAME = 'THE RESIDENS CONDOMINIUM CORPORATION';

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

export function emailDate(value) {
  if (!value) return '';
  const day = value instanceof Date ? (Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10)) : String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return 'Not specified';
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) return 'Not specified';
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
}

export function emailHeading(title) {
  return `<h2 style="margin:24px 0 8px;font-size:16px;color:#205c46">${escapeHtml(title)}</h2>`;
}

export function emailDetails(details) {
  const rows = details.filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([label, value]) => `<tr><td style="padding:7px 12px 7px 0;color:#5b6b63;vertical-align:top;width:115px">${escapeHtml(label)}</td><td style="padding:7px 0;word-break:break-word;color:#183c2c">${escapeHtml(value)}</td></tr>`).join('');
  return `<table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>`;
}

export function emailCode(code, label = 'Your verification code') {
  return `<div style="margin:20px 0;padding:16px;background:#edf6f0;border:1px solid #cfe4d6;border-radius:8px"><div style="color:#5b6b63;font-size:13px">${escapeHtml(label)}</div><div style="margin-top:8px;font-family:Consolas,monospace;font-size:30px;font-weight:bold;letter-spacing:4px;color:#183c2c">${escapeHtml(code)}</div></div>`;
}

export function emailButton(url, label) {
  return `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 20px;background:#205c46;border:1px solid #205c46;border-radius:6px;color:#ffffff;font-weight:bold;line-height:1.4;text-decoration:none">${escapeHtml(label)}</a></p>`;
}

// Body is trusted markup assembled by the email builders. Every dynamic field
// is escaped there or by the helpers above; styling stays inline for mail clients.
export function emailTemplate({ title, body, companyName = EMAIL_COMPANY_NAME, footer = 'This email is intended only for its recipient. If you received it in error, please notify the sender and delete it.' }) {
  return `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f2f6f3;font-family:Arial,Helvetica,sans-serif;color:#263c30">
<table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:24px 12px">
<table role="presentation" align="center" style="width:100%;max-width:600px;margin:0 auto;border-collapse:collapse;background:#ffffff;border:1px solid #dce7df">
<tr><td style="padding:24px;background:#205c46;color:#ffffff"><div style="font-size:13px;letter-spacing:1px">${escapeHtml(companyName)}</div><h1 style="margin:8px 0 0;font-size:24px;line-height:1.3">${escapeHtml(title)}</h1></td></tr>
<tr><td style="padding:24px;font-size:14px;line-height:1.65">${body}
<p style="margin-top:24px">Thank you,<br><strong>${escapeHtml(companyName)} Billing Team</strong></p>
<p style="margin:28px 0 0;padding-top:16px;border-top:1px solid #e3eae6;color:#66766c;font-size:11px;line-height:1.5">${escapeHtml(footer)}</p>
</td></tr></table></td></tr></table></body></html>`;
}

// #endregion

// #region Registration and account verification emails

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
    html: emailTemplate({ title: 'Verify your email address', body: `<p style="margin:0 0 18px">${escapeHtml(recipient)}</p><p>Verify your email address for your <strong>RSG Condo Water Billing</strong> account.</p>${emailButton(url, 'Verify email address')}<p>This link expires in <strong>24 hours</strong>. If you did not create this account, you can ignore this email.</p>` }),
    url,
  };
}

export function buildEmailChangeMessage({ fullName, otp }) {
  const recipient = fullName ? `Hello ${fullName},` : 'Hello,';
  return {
    subject: 'Verify your new The ResiDens email address',
    text: `${recipient}\n\nYour email change code is: ${otp}\n\nEnter this code in Settings to confirm your new email address. It expires in 10 minutes. Your current email stays unchanged until verification. Never share this code. If you did not request this change, ignore this email.`,
    html: emailTemplate({ title: 'Confirm your new email address', body: `<p style="margin:0 0 18px">${escapeHtml(recipient)}</p><p>Enter this code in <strong>Settings</strong> to confirm your new email address:</p>${emailCode(otp, 'Your email change code')}<p>This code expires in <strong>10 minutes</strong>. Your current email stays unchanged until verification.</p><p>Never share this code. If you did not request this change, ignore this email.</p>` }),
  };
}

export function buildRegistrationEmailMessage({ otp }) {
  return {
    subject: 'Your The ResiDens registration code',
    text: `Your registration code is: ${otp}\n\nEnter this code to verify your email before creating an account. It expires in 10 minutes and can only be used once. Never share it. If you did not request this, ignore this email.`,
    html: emailTemplate({ title: 'Verify your email to register', body: `<p style="margin:0 0 18px">Hello,</p><p>Thank you for registering with <strong>The ResiDens</strong>. Enter this code to verify your email before creating an account:</p>${emailCode(otp, 'Your registration code')}<p>This code expires in <strong>10 minutes</strong> and can only be used once.</p><p>Never share it. If you did not request this, ignore this email.</p>` }),
  };
}

export function createEmailVerificationService({
  environment = process.env,
  createTransport = nodemailer.createTransport,
} = {}) {
  return {
    async sendRegistrationCode({ email, otp }) {
      const message = buildRegistrationEmailMessage({ otp });
      const config = emailConfiguration(environment);
      const transporter = createTransport({ host:config.host,port:config.port,secure:config.secure,auth:config.auth,
        connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000 });
      await transporter.sendMail({ from:config.from,to:email,subject:message.subject,text:message.text,html:message.html });
      return message;
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

// #endregion

// #region SOA notifications and reminders

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

function money(value) {
  return `PHP ${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function billUrl(clientUrl, billId) {
  return `${String(clientUrl || "http://localhost:5173").replace(/\/$/, "")}/resident/bills/${billId}`;
}

function categoryText(delivery) {
  if (delivery.waterBalance === undefined) return '';
  return delivery.relationshipType === 'TENANT'
    ? `\nWater balance: ${money(delivery.waterBalance)} (association dues are the owner's balance).`
    : `\nWater balance: ${money(delivery.waterBalance)}\nAssociation balance: ${money(delivery.associationBalance)}`;
}

function statementDetails(delivery) {
  const details = [
    ['Resident', delivery.recipientName], ['Unit', delivery.unitNumber],
    ['Billing period', `${emailDate(delivery.periodStart)} to ${emailDate(delivery.periodEnd)}`], ['Due date', emailDate(delivery.dueDate)],
    [delivery.balanceLabel || 'Remaining balance', money(delivery.remainingBalance)],
  ];
  if (delivery.waterBalance !== undefined) {
    details.push(['Water balance', money(delivery.waterBalance)]);
    if (delivery.relationshipType !== 'TENANT') details.push(['Association balance', money(delivery.associationBalance)]);
  }
  if (Number(delivery.latePenaltyAmount || 0) > 0) details.push(['Late penalty included', money(delivery.latePenaltyAmount)]);
  return emailHeading('Statement details') + emailDetails(details)
    + (delivery.relationshipType === 'TENANT' && delivery.waterBalance !== undefined ? '<p style="font-size:13px;color:#5b6b63">Association dues are the owner&#39;s balance.</p>' : '');
}

export function buildSoaEmailMessage({ delivery, clientUrl }) {
  const url = billUrl(clientUrl, delivery.billId);
  const recipient = delivery.recipientName ? `Hello ${delivery.recipientName},` : "Hello,";
  const subject = `Statement of Account available — Unit ${delivery.unitNumber}`;
  const text = `${recipient}\n\nYour Statement of Account for Unit ${delivery.unitNumber} is now available.\n`
    + `Billing period: ${emailDate(delivery.periodStart)} to ${emailDate(delivery.periodEnd)}\n`
    + `Due date: ${emailDate(delivery.dueDate)}\n${delivery.balanceLabel || 'Remaining balance'}: ${money(delivery.remainingBalance)}${categoryText(delivery)}\n\n`
    + `Sign in to view your SOA: ${url}`;
  const html = emailTemplate({ title: 'Your Statement of Account is available', body:
    `<p style="margin:0 0 18px">${escapeHtml(recipient)}</p><p>Your <strong>Statement of Account</strong> for Unit ${escapeHtml(delivery.unitNumber)} is now available.</p>`
    + statementDetails(delivery) + emailButton(url, 'Sign in to view your SOA')
    + '<p>To receive a protected PDF attachment by email, open your statement in the resident portal and select <strong>Request SOA</strong>.</p><p>For assistance with your statement, please contact property management.</p>' });
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
  const subject = `${copy.subject} — Unit ${delivery.unitNumber}`;
  const text = `${recipient}\n\n${copy.intro}\n`
    + `Billing period: ${emailDate(delivery.periodStart)} to ${emailDate(delivery.periodEnd)}\n`
    + `Due date: ${emailDate(delivery.dueDate)}\n${delivery.balanceLabel || 'Remaining balance'}: ${money(delivery.remainingBalance)}${categoryText(delivery)}${penaltyText}\n\n`
    + `Sign in to view and pay your SOA: ${url}`;
  const html = emailTemplate({ title: copy.subject, body:
    `<p style="margin:0 0 18px">${escapeHtml(recipient)}</p><p>${escapeHtml(copy.intro)}</p>`
    + statementDetails(delivery) + emailButton(url, 'Sign in to view and pay your SOA')
    + '<p>To receive a protected PDF attachment by email, open your statement in the resident portal and select <strong>Request SOA</strong>.</p><p>For assistance with your account or payment, please contact property management.</p>' });
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

// #endregion

// #region Protected SOA attachment emails

export function buildProtectedSoaEmailMessage({ reference, password, residentName, unitNumber, periodStart, periodEnd, dueDate, companyName }) {
  const company = companyName || EMAIL_COMPANY_NAME;
  const filename = `SOA-${reference}.pdf`;
  const details = [
    ['Resident', residentName], ['Unit', unitNumber], ['Billing period', `${emailDate(periodStart)} to ${emailDate(periodEnd)}`],
    ['Due date', emailDate(dueDate)], ['Reference', reference], ['Attachment', filename],
  ].filter(([, value]) => value !== undefined && value !== null && value !== '');
  const instructions = [
    '1. Download the PDF attached to this email.',
    '2. Open the PDF and enter the document password when prompted.',
    'Your password is your last name in lowercase, without spaces, followed by the four random numbers assigned to this request. Keep accents, apostrophes and hyphens as shown in the password below.',
    `Your four numbers: ${password.slice(-4)}`,
    `Document password: ${password}`,
    'The password is case-sensitive. Use the exact password above, with no spaces. Each new SOA request has its own password; use the password from the same email as the attachment.',
  ];
  const text = [
    `Dear ${residentName},`, '',
    'Thank you for requesting your Statement of Account (SOA). Your password-protected PDF is attached to this email. You can download and save the attachment for your records.', '',
    'Statement details', ...details.map(([label, value]) => `${label}: ${value}`), '',
    'How to open your protected SOA', ...instructions, '',
    'For assistance with your statement or attachment, please contact property management.', '',
    'Thank you,', `${company} Billing Team`, '',
    'Confidentiality notice: This email and its attachment are intended only for the named resident. Keep the PDF and password private. If you received this email in error, please notify the sender and delete the email and attachment.',
  ].join('\n');
  const html = emailTemplate({ title: 'Your Statement of Account', companyName: company,
    footer: 'Confidentiality notice: This email and its attachment are intended only for the named resident. Keep the PDF and password private. If you received this email in error, please notify the sender and delete the email and attachment.', body: `
<p style="margin:0 0 18px">Dear ${escapeHtml(residentName)},</p>
<p>Thank you for requesting your Statement of Account (SOA). Your password-protected PDF is attached to this email. You can download and save the attachment for your records.</p>
${emailHeading('Statement details')}${emailDetails(details)}
${emailHeading('How to open your protected SOA')}
<ol style="padding-left:22px"><li>Download the PDF attached to this email.</li><li>Open the PDF and enter the document password when prompted.</li></ol>
<p>Your password is your <strong>last name in lowercase, without spaces, followed by four random numbers</strong> assigned to this request. Keep accents, apostrophes and hyphens as shown below.</p>
<div style="padding:16px;background:#edf6f0;border:1px solid #cfe4d6;border-radius:8px"><div>Your four numbers: <strong>${escapeHtml(password.slice(-4))}</strong></div><div style="margin-top:8px">Document password</div><div style="margin-top:4px;font-family:Consolas,monospace;font-size:18px;font-weight:bold;overflow-wrap:anywhere;word-break:break-all">${escapeHtml(password)}</div></div>
<p style="font-size:13px">The password is case-sensitive. Use the exact password above, with no spaces. Each new SOA request has its own password; use the password from the same email as the attachment.</p>
<p style="margin-top:24px">For assistance with your statement or attachment, please contact property management.</p>` });
  return { subject: `Your requested SOA — Unit ${unitNumber} · ${reference}`, text, html, filename };
}

export function protectedSmtpOptions(env = process.env) {
  for (const name of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM']) {
    if (!String(env[name] || '').trim()) throw new Error('PROTECTED_EMAIL_CONFIGURATION');
  }
  const port = Number(env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PROTECTED_EMAIL_CONFIGURATION');
  const secure = String(env.SMTP_SECURE).toLowerCase() === 'true';
  return {
    host: env.SMTP_HOST.trim(), port, secure, requireTLS: !secure,
    auth: { user: env.SMTP_USER.trim(), pass: env.SMTP_PASSWORD },
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
    logger: false, debug: false,
  };
}

export function createProtectedSoaMailer({ environment = process.env, createTransport = nodemailer.createTransport } = {}) {
  return {
    async verify() {
      const transport = createTransport(protectedSmtpOptions(environment));
      try { await transport.verify(); } finally { transport.close(); }
    },
    async send({ email, pdf, ...details }) {
      if (!Buffer.isBuffer(pdf) || !pdf.length) throw new Error('SOA_EMAIL_FAILED');
      const message = buildProtectedSoaEmailMessage(details);
      const transport = createTransport(protectedSmtpOptions(environment));
      try {
        const result = await transport.sendMail({
          from: environment.SMTP_FROM.trim(), to: { address: email },
          subject: message.subject, text: message.text, html: message.html,
          headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
          attachments: [{ filename: message.filename, content: pdf, contentType: 'application/pdf', contentDisposition: 'attachment' }],
          disableFileAccess: true, disableUrlAccess: true,
        });
        const accepted = (result.accepted || []).map(value => String(value.address || value).toLowerCase());
        if (!accepted.includes(email.toLowerCase()) || result.rejected?.length || result.pending?.length) throw new Error('EMAIL_NOT_ACCEPTED');
      } catch {
        // SMTP errors may contain the envelope or message. Never propagate them.
        throw new Error('SOA_EMAIL_FAILED');
      } finally { transport.close(); }
    },
  };
}

// #endregion

// #region Publication email delivery

export async function deliverSoaEmailNotifications(deliveryIds) {
  const ids = [...new Set((deliveryIds || []).map(Number).filter(Number.isSafeInteger))];
  if (!ids.length) return { sent: 0, failed: 0 };

  const result = await pool.query(
    `SELECT d.id, d.recipient_name AS "recipientName", d.recipient_email AS "recipientEmail",
      b.id AS "billId", b.unit_number_snapshot AS "unitNumber",
      b.period_start_snapshot AS "periodStart", b.period_end_snapshot AS "periodEnd",
      b.due_date_snapshot AS "dueDate",
      ${chargePaymentsSql} AS "chargePayments", CASE WHEN EXISTS(SELECT 1 FROM unit_assignments owner
        WHERE owner.unit_id=b.unit_id AND owner.user_id=d.recipient_user_id AND owner.end_date IS NULL
        AND owner.start_date <= (NOW() AT TIME ZONE 'Asia/Manila')::date AND owner.relationship_type='OWNER') THEN 'OWNER' ELSE 'TENANT' END AS "relationshipType",
      GREATEST(${billTotalSql} - ${billAppliedSql}, 0) AS "remainingBalance"
     FROM soa_email_deliveries d
     JOIN unit_bills b ON b.id = d.unit_bill_id
     WHERE d.id = ANY($1::bigint[]) AND d.status = 'PENDING' AND b.published_at IS NOT NULL`,
    [ids],
  );

  const outcomes = [];
  for (const delivery of result.rows.map(recipientPaymentDetails)) {
    let error = null;
    try { await sendSoaNotification(delivery); } catch (failure) { error = failure; }
    outcomes.push({ delivery, error });
  }
  return saveDeliveryOutcomes(pool, outcomes);
}

// #endregion

// #region Reminder scheduling and deduplication

export const REMINDER_TYPES = Object.freeze({
  DUE_SOON: "DUE_SOON",
  DUE_TODAY: "DUE_TODAY",
  OVERDUE: "OVERDUE",
});

const MAX_ATTEMPTS = 3;
const DEFAULT_TIMEZONE = "Asia/Manila";

function dateParts(date, timeZone) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

export function dateInTimezone(date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const parts = dateParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function daysBetween(start, end) {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return Math.round((endMs - startMs) / 86_400_000);
}

export function reminderTypeForDueDate(dueDate, today) {
  const daysUntilDue = daysBetween(today, dueDate);
  if (daysUntilDue < 0) return REMINDER_TYPES.OVERDUE;
  if (daysUntilDue === 0) return REMINDER_TYPES.DUE_TODAY;
  if (daysUntilDue <= 3) return REMINDER_TYPES.DUE_SOON;
  return null;
}


async function recoverInterruptedDeliveries(database) {
  await database.query(
    `UPDATE soa_reminder_deliveries
     SET status = 'FAILED', last_error = COALESCE(last_error, 'Previous reminder run ended before delivery completed.')
     WHERE status = 'PROCESSING' AND last_attempted_at < NOW() - INTERVAL '15 minutes'`,
  );
}

async function eligibleRecipients(database, today) {
  const result = await database.query(
    `SELECT b.id AS "billId", b.unit_number_snapshot AS "unitNumber",
      b.period_start_snapshot AS "periodStart", b.period_end_snapshot AS "periodEnd",
      b.due_date_snapshot AS "dueDate", COALESCE(b.late_penalty_amount, 0) AS "latePenaltyAmount",
      assignment.user_id AS "recipientUserId", usr.full_name AS "recipientName", LOWER(usr.email) AS "recipientEmail",
      ${chargePaymentsSql} AS "chargePayments", CASE WHEN EXISTS(SELECT 1 FROM unit_assignments owner
        WHERE owner.unit_id=b.unit_id AND owner.user_id=assignment.user_id AND owner.end_date IS NULL
        AND owner.start_date <= $1::date AND owner.relationship_type='OWNER') THEN 'OWNER' ELSE 'TENANT' END AS "relationshipType",
      GREATEST(${billTotalSql} - ${billAppliedSql}, 0) AS "remainingBalance"
     FROM unit_bills b
     JOIN billing_periods p ON p.id = b.billing_period_id
     JOIN unit_assignments assignment ON assignment.unit_id = b.unit_id AND assignment.end_date IS NULL
     JOIN users usr ON usr.id = assignment.user_id AND usr.is_active = TRUE
     WHERE b.published_at IS NOT NULL
       AND p.status IN ('FORWARDED', 'CLOSED')
       AND assignment.relationship_type IN ('OWNER', 'TENANT')
       AND assignment.start_date <= $1::date
       AND NULLIF(TRIM(usr.email), '') IS NOT NULL
       AND GREATEST(${billTotalSql} - ${billAppliedSql}, 0) > 0.005
       AND b.due_date_snapshot <= ($1::date + 3)
     ORDER BY b.id, LOWER(usr.email), assignment.id`,
    [today],
  );
  return result.rows.map(recipientPaymentDetails).map((row) => ({ ...row, reminderType: reminderTypeForDueDate(row.dueDate, today) }))
    .filter((row) => row.reminderType && Number(row.remainingBalance) > 0);
}

async function claimReminderDelivery(database, delivery) {
  await database.query(
    `UPDATE soa_reminder_deliveries
     SET status = 'SKIPPED', last_error = NULL
     WHERE unit_bill_id = $1 AND recipient_email = $2 AND due_date = $3
       AND reminder_type <> $4 AND status IN ('PENDING', 'FAILED')`,
    [delivery.billId, delivery.recipientEmail, delivery.dueDate, delivery.reminderType],
  );

  const event = await database.query(
    `INSERT INTO soa_reminder_deliveries
       (unit_bill_id, recipient_user_id, recipient_name, recipient_email, due_date, reminder_type)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (unit_bill_id, recipient_email, due_date, reminder_type) DO UPDATE
       SET recipient_user_id = EXCLUDED.recipient_user_id,
           recipient_name = EXCLUDED.recipient_name,
           updated_at = NOW()
       WHERE soa_reminder_deliveries.status IN ('PENDING', 'FAILED')
     RETURNING id`,
    [delivery.billId, delivery.recipientUserId, delivery.recipientName, delivery.recipientEmail, delivery.dueDate, delivery.reminderType],
  );
  const id = event.rows[0]?.id;
  if (!id) return null;

  const claimed = await database.query(
    `UPDATE soa_reminder_deliveries
     SET status = 'PROCESSING', attempt_count = attempt_count + 1, last_attempted_at = NOW(), last_error = NULL
     WHERE id = $1 AND status IN ('PENDING', 'FAILED') AND attempt_count < $2
     RETURNING id, attempt_count AS "attemptCount"`,
    [id, MAX_ATTEMPTS],
  );
  return claimed.rows[0] || null;
}

export async function runSoaReminderJob({
  database = pool,
  sendReminder = sendSoaReminder,
  applyLatePenalties = applyDueLatePenalties,
  now = new Date(),
  timeZone = DEFAULT_TIMEZONE,
  logger = console,
} = {}) {
  const today = dateInTimezone(now, timeZone);
  await recoverInterruptedDeliveries(database);
  await applyLatePenalties(database, null, today);

  const candidates = await eligibleRecipients(database, today);
  const summary = { today, candidates: candidates.length, sent: 0, failed: 0, skipped: 0 };
  for (const delivery of candidates) {
    const claimed = await claimReminderDelivery(database, delivery);
    if (!claimed) {
      summary.skipped += 1;
      continue;
    }
    let failure = null;
    try { await sendReminder(delivery, delivery.reminderType); } catch (error) { failure = error; }
    await saveDeliveryOutcomes(database, [{ delivery: { ...delivery, id: claimed.id }, error: failure }], { reminder: true });
    if (failure) { summary.failed += 1; logger.error("SOA reminder delivery failed:", failure.message); }
    else summary.sent += 1;
  }
  logger.log(`SOA reminder job complete: ${summary.sent} sent, ${summary.failed} failed, ${summary.skipped} skipped.`);
  return summary;
}

function isEnabled(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

export function startSoaReminderScheduler({ environment = process.env, logger = console } = {}) {
  if (!isEnabled(environment.SOA_REMINDER_SCHEDULER_ENABLED)) {
    logger.log("SOA reminder scheduler is disabled.");
    return null;
  }

  const timeZone = environment.SOA_REMINDER_TIMEZONE || DEFAULT_TIMEZONE;
  let running = false;
  const run = async (source) => {
    if (running) return;
    running = true;
    try {
      const summary = await runSoaReminderJob({ timeZone, logger });
      logger.log(`SOA reminder ${source} run completed for ${summary.today}.`);
    } catch (error) {
      logger.error(`SOA reminder ${source} run failed:`, error.message);
    } finally {
      running = false;
    }
  };

  void run("startup catch-up");
  return cron.schedule("0 9 * * *", () => void run("scheduled"), { timezone: timeZone });
}

// #endregion
