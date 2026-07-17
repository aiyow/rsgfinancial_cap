import express from "express";
import pool from "../config/db.js";
import { allowRoles, requireAuth } from "../middleware/authMiddleware.js";
import { ensurePaymentLedgerSchema } from "../services/paymentLedger.js";
import { regeneratePrescriptiveRecommendations } from "../services/prescriptiveAnalytics.js";

const router = express.Router();

router.use(requireAuth, allowRoles("ADMIN", "COLLECTOR"));

router.get("/overview", async (req, res, next) => {
  try {
    await ensurePaymentLedgerSchema(pool);
    await regeneratePrescriptiveRecommendations(pool);
    const [summaryResult, trendResult, statusResult] = await Promise.all([
      pool.query(
        `WITH latest_period AS (
           SELECT id, period_start, status FROM billing_periods
           WHERE period_type = 'LIVE_BILLING' ORDER BY period_start DESC LIMIT 1
         ), bill_balances AS (
           SELECT b.id, b.billing_period_id, b.due_date_snapshot AS due_date,
             COALESCE(SUM(c.quantity * c.rate_applied), 0) AS total,
             COALESCE((SELECT SUM(pa.amount_applied) FROM payment_applications pa WHERE pa.unit_bill_id = b.id), 0) AS applied
           FROM unit_bills b LEFT JOIN bill_charges c ON c.unit_bill_id = b.id
           GROUP BY b.id
         )
         SELECT
           (SELECT period_start FROM latest_period) AS "latestPeriodStart",
           (SELECT status FROM latest_period) AS "latestPeriodStatus",
           COALESCE((SELECT SUM(total) FROM bill_balances WHERE billing_period_id = (SELECT id FROM latest_period)), 0) AS "currentBilled",
           COALESCE((SELECT SUM(applied) FROM bill_balances WHERE billing_period_id = (SELECT id FROM latest_period)), 0) AS "currentCollected",
           COALESCE((SELECT SUM(GREATEST(total - applied, 0)) FROM bill_balances), 0) AS "outstandingBalance",
           (SELECT COUNT(*)::int FROM bill_balances WHERE due_date < CURRENT_DATE AND total > applied) AS "overdueBills",
           (SELECT COUNT(*)::int FROM units WHERE occupancy_status = 'OCCUPIED') AS "occupiedUnits",
           (SELECT COUNT(*)::int FROM units WHERE occupancy_status = 'VACANT') AS "vacantUnits",
           (SELECT COUNT(*)::int FROM payment_submissions WHERE review_status = 'PENDING') AS "pendingPayments",
           (SELECT COUNT(*)::int FROM prescriptive_recommendations WHERE status IN ('OPEN', 'VIEWED')) AS "openRecommendations",
           (SELECT COUNT(*)::int FROM prescriptive_recommendations WHERE status IN ('OPEN', 'VIEWED') AND priority = 'HIGH') AS "highPriorityRecommendations"`,
      ),
      pool.query(
        `WITH recent_periods AS (
           SELECT id, period_start FROM billing_periods
           WHERE period_type = 'LIVE_BILLING' ORDER BY period_start DESC LIMIT 6
         ), bill_balances AS (
           SELECT b.id, b.billing_period_id,
             COALESCE(SUM(c.quantity * c.rate_applied), 0) AS billed,
             COALESCE((SELECT SUM(pa.amount_applied) FROM payment_applications pa WHERE pa.unit_bill_id = b.id), 0) AS collected
           FROM unit_bills b LEFT JOIN bill_charges c ON c.unit_bill_id = b.id
           WHERE b.billing_period_id IN (SELECT id FROM recent_periods)
           GROUP BY b.id
         ), bill_totals AS (
           SELECT billing_period_id, SUM(billed) AS billed, SUM(collected) AS collected
           FROM bill_balances
           GROUP BY billing_period_id
         ), consumption AS (
           SELECT m.billing_period_id,
             COALESCE(SUM(m.current_reading - m.previous_reading) FILTER (WHERE m.validation_status = 'VALID'), 0) AS consumption
           FROM meter_readings m WHERE m.billing_period_id IN (SELECT id FROM recent_periods)
           GROUP BY m.billing_period_id
         )
         SELECT p.period_start AS month, COALESCE(b.billed, 0) AS billed,
           COALESCE(b.collected, 0) AS collected, COALESCE(c.consumption, 0) AS consumption
         FROM recent_periods p LEFT JOIN bill_totals b ON b.billing_period_id = p.id
         LEFT JOIN consumption c ON c.billing_period_id = p.id
         ORDER BY p.period_start`,
      ),
      pool.query(
        `WITH bill_balances AS (
           SELECT b.id, b.due_date_snapshot AS due_date,
             COALESCE(SUM(c.quantity * c.rate_applied), 0) AS total,
             COALESCE((SELECT SUM(pa.amount_applied) FROM payment_applications pa WHERE pa.unit_bill_id = b.id), 0) AS applied
           FROM unit_bills b LEFT JOIN bill_charges c ON c.unit_bill_id = b.id
           GROUP BY b.id
         )
         SELECT CASE
           WHEN total > 0 AND applied >= total THEN 'Paid'
           WHEN applied > 0 THEN 'Partially paid'
           WHEN due_date < CURRENT_DATE THEN 'Overdue'
           ELSE 'Unpaid'
         END AS name, COUNT(*)::int AS value
         FROM bill_balances GROUP BY 1 ORDER BY 1`,
      ),
    ]);

    return res.json({ metrics: summaryResult.rows[0], monthly: trendResult.rows, billStatus: statusResult.rows });
  } catch (error) { return next(error); }
});

export default router;
