import { saveDeliveryOutcomes } from './auditDelivery.js';
import pool from "../config/db.js";
import { billAppliedSql, billTotalSql, chargePaymentsSql } from "./paymentLedger.js";
import { recipientPaymentDetails } from './paymentRecipients.js';
import { sendSoaNotification } from "./soaEmail.js";


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
