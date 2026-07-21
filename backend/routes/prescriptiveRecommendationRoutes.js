import express from "express";
import pool from "../config/db.js";
import { allowRoles, requireAuth } from "../middleware/authMiddleware.js";
import { requireId } from "../middleware/validate.js";
import { writeAuditLog } from "../services/auditLog.js";
import { ensurePrescriptiveAnalyticsSchema } from "../services/prescriptiveAnalytics.js";

const router = express.Router();
const statuses = new Set(["ACTIVE", "ALL", "OPEN", "VIEWED", "SUPERSEDED"]);
const priorities = new Set(["ALL", "HIGH", "MEDIUM"]);
const residentRecommendationTypes = ["CHECK_HIGH_USAGE", "RISING_CONSUMPTION", "PAYMENT_REMINDER", "MONITOR_HIGH_USAGE", "MONITOR_USAGE"];

const recommendationSelect = `SELECT r.id, r.unit_id AS "unitId", u.unit_number AS "unitNumber",
  r.based_on_period_id AS "basedOnPeriodId", p.period_start AS "periodStart",
  r.forecast_id AS "forecastId", r.recommendation_type AS "recommendationType",
  r.priority, r.status, r.message, r.evidence,
  r.resident_visible_at AS "residentVisibleAt", r.resident_visible_by AS "residentVisibleBy",
  r.created_at AS "createdAt", r.updated_at AS "updatedAt",
  f.forecast_for_month AS "forecastForMonth", f.predicted_consumption AS "predictedConsumption"
  FROM prescriptive_recommendations r
  JOIN units u ON u.id = r.unit_id
  JOIN billing_periods p ON p.id = r.based_on_period_id
  LEFT JOIN billing_forecasts f ON f.id = r.forecast_id`;

router.use(requireAuth);

router.get("/resident", allowRoles("RESIDENT"), async (req, res, next) => {
  try {
    const result = await pool.query(
      `${recommendationSelect}
       JOIN unit_assignments a ON a.unit_id = r.unit_id
       WHERE a.user_id = $1 AND a.end_date IS NULL
         AND r.recommendation_type = ANY($2::varchar[])
         AND r.resident_visible_at IS NOT NULL
         AND r.status = ANY($3::varchar[])
         AND p.period_type = 'LIVE_BILLING'
         AND p.status IN ('GENERATED', 'FORWARDED', 'CLOSED')
       ORDER BY r.updated_at DESC, u.unit_number`,
      [req.user.id, residentRecommendationTypes, ["OPEN", "VIEWED"]],
    );
    return res.json({ recommendations: result.rows });
  } catch (error) { return next(error); }
});

router.patch("/:id/view", allowRoles("RESIDENT"), requireId, async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const existing = await client.query(
      `${recommendationSelect}
       JOIN unit_assignments a ON a.unit_id = r.unit_id
       WHERE r.id = $1 AND a.user_id = $2 AND a.end_date IS NULL
         AND r.recommendation_type = ANY($3::varchar[])
         AND r.resident_visible_at IS NOT NULL
         AND r.status = ANY($4::varchar[])
         AND p.period_type = 'LIVE_BILLING'
         AND p.status IN ('GENERATED', 'FORWARDED', 'CLOSED')
       FOR UPDATE OF r`,
      [req.resourceId, req.user.id, residentRecommendationTypes, ["OPEN", "VIEWED"]],
    );
    const recommendation = existing.rows[0];
    if (!recommendation) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Prescriptive insight not found." });
    }
    if (recommendation.status === "OPEN") {
      await client.query(
        "UPDATE prescriptive_recommendations SET status = 'VIEWED', updated_at = NOW() WHERE id = $1",
        [req.resourceId],
      );
      await writeAuditLog({
        client,
        actorUserId: req.user.id,
        entityName: "PRESCRIPTIVE_RECOMMENDATION",
        entityId: req.resourceId,
        action: "VIEWED",
        oldValues: { status: "OPEN" },
        newValues: { status: "VIEWED" },
      });
    }
    const updated = await client.query(`${recommendationSelect} WHERE r.id = $1`, [req.resourceId]);
    await client.query("COMMIT");
    return res.json({ message: "Insight marked as viewed.", recommendation: updated.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally { client?.release(); }
});

router.get("/", allowRoles("ADMIN", "COLLECTOR"), async (req, res, next) => {
  try {
    const requestedStatus = String(req.query.status || "ACTIVE").trim().toUpperCase();
    const requestedPriority = String(req.query.priority || "ALL").trim().toUpperCase();
    if (!statuses.has(requestedStatus) || !priorities.has(requestedPriority)) {
      return res.status(400).json({ message: "Use a valid recommendation status and priority." });
    }
    const params = [];
    const conditions = [];
    if (requestedStatus === "ACTIVE") {
      params.push(["OPEN", "VIEWED"]);
      conditions.push(`r.status = ANY($${params.length}::varchar[])`);
    } else if (requestedStatus !== "ALL") {
      params.push(requestedStatus);
      conditions.push(`r.status = $${params.length}`);
    }
    if (requestedPriority !== "ALL") {
      params.push(requestedPriority);
      conditions.push(`r.priority = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(
      `${recommendationSelect} ${where}
       ORDER BY CASE r.priority WHEN 'HIGH' THEN 0 ELSE 1 END, r.updated_at DESC, u.unit_number`,
      params,
    );
    return res.json({ recommendations: result.rows });
  } catch (error) { return next(error); }
});

router.delete("/:id", allowRoles("ADMIN", "COLLECTOR"), requireId, async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await ensurePrescriptiveAnalyticsSchema(client);
    const existing = await client.query(`${recommendationSelect} WHERE r.id = $1 FOR UPDATE OF r`, [req.resourceId]);
    const recommendation = existing.rows[0];
    if (!recommendation) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Recommendation not found." });
    }
    await client.query("DELETE FROM prescriptive_recommendations WHERE id = $1", [req.resourceId]);
    await writeAuditLog({
      client,
      actorUserId: req.user.id,
      entityName: "PRESCRIPTIVE_RECOMMENDATION",
      entityId: req.resourceId,
      action: "DELETE",
      oldValues: recommendation,
      remarks: "Recommendation permanently deleted.",
    });
    await client.query("COMMIT");
    return res.json({ message: "Recommendation permanently deleted." });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return next(error);
  } finally { client?.release(); }
});

export default router;
