import pool from "../config/db.js";
import { billAppliedSql, billTotalSql, chargePaymentsSql } from "./paymentLedger.js";
import { recipientPaymentDetails } from './paymentRecipients.js';
import { sendSoaNotification } from "./soaEmail.js";

function deliveryError(error) {
  const message = error?.code === "EMAIL_NOT_CONFIGURED"
    ? "Email service is not configured."
    : String(error?.message || "Email delivery failed.");
  return message.slice(0, 500);
}

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

  const summary = { sent: 0, failed: 0 };
  for (const delivery of result.rows.map(recipientPaymentDetails)) {
    try {
      await sendSoaNotification(delivery);
      await pool.query(
        `UPDATE soa_email_deliveries
         SET status = 'SENT', attempt_count = attempt_count + 1, last_attempted_at = NOW(), sent_at = NOW(), last_error = NULL
         WHERE id = $1 AND status = 'PENDING'`,
        [delivery.id],
      );
      summary.sent += 1;
    } catch (error) {
      await pool.query(
        `UPDATE soa_email_deliveries
         SET status = 'FAILED', attempt_count = attempt_count + 1, last_attempted_at = NOW(), last_error = $2
         WHERE id = $1 AND status = 'PENDING'`,
        [delivery.id, deliveryError(error)],
      );
      summary.failed += 1;
    }
  }
  return summary;
}
