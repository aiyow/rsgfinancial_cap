import cron from "node-cron";
import pool from "../config/db.js";
import { applyDueLatePenalties, billAppliedSql, billTotalSql } from "./paymentLedger.js";
import { sendSoaReminder } from "./soaEmail.js";

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

function reminderError(error) {
  const message = error?.code === "EMAIL_NOT_CONFIGURED"
    ? "Email service is not configured."
    : String(error?.message || "SOA reminder email delivery failed.");
  return message.slice(0, 500);
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
      GREATEST(${billTotalSql} - ${billAppliedSql}, 0) AS "remainingBalance"
     FROM unit_bills b
     JOIN billing_periods p ON p.id = b.billing_period_id
     JOIN unit_assignments assignment ON assignment.unit_id = b.unit_id AND assignment.end_date IS NULL
     JOIN users usr ON usr.id = assignment.user_id AND usr.is_active = TRUE
     WHERE b.published_at IS NOT NULL
       AND p.status IN ('FORWARDED', 'CLOSED')
       AND assignment.relationship_type IN ('OWNER', 'TENANT')
       AND NULLIF(TRIM(usr.email), '') IS NOT NULL
       AND GREATEST(${billTotalSql} - ${billAppliedSql}, 0) > 0.005
       AND b.due_date_snapshot <= ($1::date + 3)
     ORDER BY b.id, LOWER(usr.email), assignment.id`,
    [today],
  );
  return result.rows.map((row) => ({ ...row, reminderType: reminderTypeForDueDate(row.dueDate, today) })).filter((row) => row.reminderType);
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
    try {
      await sendReminder(delivery, delivery.reminderType);
      await database.query(
        "UPDATE soa_reminder_deliveries SET status = 'SENT', sent_at = NOW(), last_error = NULL WHERE id = $1 AND status = 'PROCESSING'",
        [claimed.id],
      );
      summary.sent += 1;
    } catch (error) {
      await database.query(
        "UPDATE soa_reminder_deliveries SET status = 'FAILED', last_error = $2 WHERE id = $1 AND status = 'PROCESSING'",
        [claimed.id, reminderError(error)],
      );
      summary.failed += 1;
      logger.error("SOA reminder delivery failed:", error.message);
    }
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
