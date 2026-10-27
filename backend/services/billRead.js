import { billAppliedSql, billLatePenaltySql, billTotalSql, chargePaymentsSql } from "./paymentLedger.js";
const approvedPaymentSql = billAppliedSql;
const unitAdvanceSql = `COALESCE((SELECT ROUND(SUM(pay.verified_amount - COALESCE((
  SELECT SUM(app.amount_applied) FROM payment_applications app WHERE app.payment_submission_id = pay.id
), 0)), 2) FROM payment_submissions pay WHERE pay.unit_id = b.unit_id AND pay.review_status = 'APPROVED'), 0)`;
export const billSelect = `SELECT b.id, b.unit_id AS "unitId", b.billing_period_id AS "billingPeriodId",
  b.unit_number_snapshot AS "unitNumber", u.floor AS floor, b.period_start_snapshot AS "periodStart",
  b.period_end_snapshot AS "periodEnd", b.statement_date AS "statementDate",
  b.due_date_snapshot AS "dueDate", p.status,
  b.soa_generated_at AS "soaGeneratedAt",
  b.previous_reading_snapshot AS "previousReading",
  b.current_reading_snapshot AS "currentReading",
  b.current_reading_snapshot - b.previous_reading_snapshot AS consumption,
  b.payer_name_snapshot AS "payerName", b.payer_email_snapshot AS "payerEmail",
  b.generation_warning AS "generationWarning",
  b.invoice_number AS "invoiceNumber",
  b.payment_note AS "paymentNote", b.soa_revision AS "soaRevision",
  b.corrected_at AS "correctedAt", b.corrected_by AS "correctedBy", b.correction_reason AS "correctionReason",
  b.late_penalty_percent_snapshot AS "latePenaltyPercent",
  b.published_at AS "publishedAt", b.published_by AS "publishedBy",
  (SELECT jsonb_build_object(
    'sent', COUNT(*) FILTER (WHERE delivery.status = 'SENT')::int,
    'failed', COUNT(*) FILTER (WHERE delivery.status = 'FAILED')::int,
    'pending', COUNT(*) FILTER (WHERE delivery.status = 'PENDING')::int
   ) FROM soa_email_deliveries delivery WHERE delivery.unit_bill_id = b.id) AS "emailDelivery",
  COALESCE(b.soa_template_snapshot, (SELECT template_data FROM soa_templates WHERE id = 1)) AS "soaTemplate",
  ${billLatePenaltySql} AS "latePenaltyAmount", ${billTotalSql} AS "totalAmount", ${approvedPaymentSql} AS "approvedAmount",
  ${unitAdvanceSql} AS "advanceBalance",
  ${chargePaymentsSql} AS "chargePayments",
  GREATEST(${billTotalSql} - ${approvedPaymentSql}, 0) AS "remainingBalance",
  EXISTS (
    SELECT 1
    FROM payment_submissions pending
    WHERE pending.target_unit_bill_id = b.id AND pending.review_status = 'PENDING'
  ) AS "hasPendingPayment",
  CASE WHEN ${approvedPaymentSql} >= ${billTotalSql} AND ${billTotalSql} > 0 THEN 'PAID'
    WHEN ${approvedPaymentSql} > 0 THEN 'PARTIAL'
    WHEN b.due_date_snapshot < CURRENT_DATE THEN 'OVERDUE' ELSE 'UNPAID' END AS "paymentStatus"
  FROM unit_bills b
  JOIN billing_periods p ON p.id = b.billing_period_id
  JOIN units u ON u.id = b.unit_id
  LEFT JOIN bill_charges c ON c.unit_bill_id = b.id`;
export const groupBy = "GROUP BY b.id, p.status, b.soa_template_snapshot, u.floor";

