import express from "express";
import pool from "../config/db.js";
import { allowRoles, requireAuth } from "../middleware/authMiddleware.js";
import { requireId } from "../middleware/validate.js";
import { calculateAccuracy } from "../services/predictiveAnalytics.js";

const router = express.Router();

const historySelect = `SELECT m.unit_id AS "unitId", u.unit_number AS "unitNumber",
  p.id AS "billingPeriodId", p.period_start AS "periodStart", p.period_end AS "periodEnd",
  m.previous_reading AS "previousReading", m.current_reading AS "currentReading",
  m.current_reading - m.previous_reading AS consumption,
  ROUND((m.current_reading - m.previous_reading) * p.water_rate_per_cubic_m, 2) AS "waterCharge",
  p.water_rate_per_cubic_m AS "waterRate", m.validation_status AS "validationStatus",
  m.validation_notes AS "validationNotes"
  FROM meter_readings m
  JOIN units u ON u.id = m.unit_id
  JOIN billing_periods p ON p.id = m.billing_period_id`;

const forecastSelect = `SELECT f.id, f.unit_id AS "unitId", u.unit_number AS "unitNumber",
  f.based_on_period_id AS "basedOnPeriodId", p.period_start AS "basedOnPeriodStart",
  f.forecast_for_month AS "forecastForMonth", f.predicted_consumption AS "predictedConsumption",
  f.estimated_water_charge AS "estimatedWaterCharge", f.model_name AS "modelName",
  f.sample_count AS "sampleCount", f.slope, f.intercept,
  f.forecast_status AS status, f.status_reason AS reason, f.generated_at AS "generatedAt"
  FROM billing_forecasts f
  JOIN units u ON u.id = f.unit_id
  JOIN billing_periods p ON p.id = f.based_on_period_id`;

router.use(requireAuth);

router.get("/resident", allowRoles("RESIDENT"), async (req, res, next) => {
  try {
    const unitsResult = await pool.query(
      `SELECT u.id, u.unit_number AS "unitNumber", a.relationship_type AS "relationshipType"
       FROM unit_assignments a JOIN units u ON u.id = a.unit_id
       WHERE a.user_id = $1 AND a.end_date IS NULL ORDER BY u.unit_number`,
      [req.user.id],
    );
    const unitIds = unitsResult.rows.map((unit) => Number(unit.id));
    if (unitIds.length === 0) return res.json({ units: [] });

    const [historyResult, forecastsResult] = await Promise.all([
      pool.query(
        `${historySelect}
         WHERE m.unit_id = ANY($1::bigint[])
           AND (p.analytics_only = FALSE OR p.readings_visible_at IS NOT NULL)
         ORDER BY m.unit_id, p.period_start`,
        [unitIds],
      ),
      pool.query(
        `SELECT DISTINCT ON (f.unit_id) f.id, f.unit_id AS "unitId",
          f.based_on_period_id AS "basedOnPeriodId", f.forecast_for_month AS "forecastForMonth",
          f.predicted_consumption AS "predictedConsumption", f.estimated_water_charge AS "estimatedWaterCharge",
          f.model_name AS "modelName", f.sample_count AS "sampleCount", f.forecast_status AS status,
          f.status_reason AS reason, f.generated_at AS "generatedAt"
         FROM billing_forecasts f
         JOIN billing_periods source ON source.id = f.based_on_period_id
         WHERE f.unit_id = ANY($1::bigint[])
           AND (source.analytics_only = FALSE OR source.readings_visible_at IS NOT NULL)
         ORDER BY f.unit_id, f.forecast_for_month DESC, f.generated_at DESC`,
        [unitIds],
      ),
    ]);
    const historyByUnit = new Map();
    for (const row of historyResult.rows) {
      const id = Number(row.unitId);
      if (!historyByUnit.has(id)) historyByUnit.set(id, []);
      historyByUnit.get(id).push(row);
    }
    const forecastByUnit = new Map(forecastsResult.rows.map((row) => [Number(row.unitId), row]));
    return res.json({
      units: unitsResult.rows.map((unit) => ({
        ...unit,
        history: historyByUnit.get(Number(unit.id)) || [],
        forecast: forecastByUnit.get(Number(unit.id)) || null,
      })),
    });
  } catch (error) { return next(error); }
});

router.get("/overview", allowRoles("ADMIN", "COLLECTOR"), async (req, res, next) => {
  try {
    const evaluationMonthResult = await pool.query(
      `SELECT MAX(f.forecast_for_month) AS "evaluationMonth"
       FROM billing_forecasts f
       JOIN billing_periods source ON source.id = f.based_on_period_id
       WHERE (source.analytics_only = FALSE OR source.readings_visible_at IS NOT NULL)
         AND EXISTS (
           SELECT 1 FROM meter_readings actual
           JOIN billing_periods ap ON ap.id = actual.billing_period_id
           WHERE actual.unit_id = f.unit_id
             AND (ap.analytics_only = FALSE OR ap.readings_visible_at IS NOT NULL)
             AND DATE_TRUNC('month', ap.period_start) = DATE_TRUNC('month', f.forecast_for_month))`,
    );
    const evaluationMonth = evaluationMonthResult.rows[0]?.evaluationMonth || null;
    let diagnostics = [];
    if (evaluationMonth) {
      const result = await pool.query(
        `SELECT f.unit_id AS "unitId", u.unit_number AS "unitNumber", f.forecast_for_month AS "forecastForMonth",
          f.predicted_consumption AS "predictedConsumption",
          actual.current_reading - actual.previous_reading AS "actualConsumption",
          f.forecast_status AS status, f.status_reason AS reason,
          actual.validation_status AS "actualValidationStatus", actual.validation_notes AS "actualValidationNotes"
         FROM billing_forecasts f
         JOIN billing_periods source ON source.id = f.based_on_period_id
         JOIN units u ON u.id = f.unit_id
         LEFT JOIN billing_periods ap ON DATE_TRUNC('month', ap.period_start) = DATE_TRUNC('month', f.forecast_for_month)
          AND (ap.analytics_only = FALSE OR ap.readings_visible_at IS NOT NULL)
         LEFT JOIN meter_readings actual ON actual.billing_period_id = ap.id AND actual.unit_id = f.unit_id
         WHERE DATE_TRUNC('month', f.forecast_for_month) = DATE_TRUNC('month', $1::date)
           AND (source.analytics_only = FALSE OR source.readings_visible_at IS NOT NULL)
         ORDER BY u.unit_number`,
        [evaluationMonth],
      );
      diagnostics = result.rows.map((row) => ({
        ...row,
        absoluteError: row.predictedConsumption !== null && row.actualConsumption !== null
          ? Number(Math.abs(Number(row.predictedConsumption) - Number(row.actualConsumption)).toFixed(3))
          : null,
      }));
    }
    const eligible = diagnostics.filter((row) => row.status === "READY" && row.actualValidationStatus === "VALID");
    const latestForecastResult = await pool.query(
      `SELECT f.forecast_for_month AS "forecastForMonth",
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE f.forecast_status = 'READY')::int AS ready,
        COUNT(*) FILTER (WHERE f.forecast_status <> 'READY')::int AS excluded
       FROM billing_forecasts f
       JOIN billing_periods source ON source.id = f.based_on_period_id
       WHERE f.based_on_period_id = (
         SELECT f2.based_on_period_id
         FROM billing_forecasts f2
         JOIN billing_periods source2 ON source2.id = f2.based_on_period_id
         WHERE (source2.analytics_only = FALSE OR source2.readings_visible_at IS NOT NULL)
         ORDER BY f2.generated_at DESC LIMIT 1
       )
       AND (source.analytics_only = FALSE OR source.readings_visible_at IS NOT NULL)
       GROUP BY f.forecast_for_month`,
    );
    const flaggedResult = await pool.query(
      `SELECT m.id, m.unit_id AS "unitId", u.unit_number AS "unitNumber", p.period_start AS "periodStart",
        m.previous_reading AS "previousReading", m.current_reading AS "currentReading",
        m.validation_notes AS reason
       FROM meter_readings m JOIN units u ON u.id = m.unit_id
       JOIN billing_periods p ON p.id = m.billing_period_id
       WHERE (p.analytics_only = FALSE OR p.readings_visible_at IS NOT NULL)
         AND m.validation_status = 'FLAGGED'
       ORDER BY p.period_start DESC, u.unit_number LIMIT 100`,
    );
    const actualChartResult = await pool.query(
      `SELECT DATE_TRUNC('month', p.period_start)::date AS month,
        ROUND(SUM(m.current_reading - m.previous_reading), 3) AS "actualConsumption",
        ROUND(SUM((m.current_reading - m.previous_reading) * p.water_rate_per_cubic_m), 2) AS "actualWaterBill"
       FROM meter_readings m
       JOIN billing_periods p ON p.id = m.billing_period_id
       WHERE (p.analytics_only = FALSE OR p.readings_visible_at IS NOT NULL)
         AND m.validation_status = 'VALID'
       GROUP BY DATE_TRUNC('month', p.period_start)
       ORDER BY month`,
    );
    const forecastChartResult = await pool.query(
      `SELECT DATE_TRUNC('month', f.forecast_for_month)::date AS month,
        ROUND(SUM(f.predicted_consumption), 3) AS "projectedConsumption",
        ROUND(SUM(f.estimated_water_charge), 2) AS "projectedWaterBill"
       FROM billing_forecasts f
       JOIN billing_periods source ON source.id = f.based_on_period_id
       WHERE (source.analytics_only = FALSE OR source.readings_visible_at IS NOT NULL)
         AND f.forecast_status = 'READY'
       GROUP BY DATE_TRUNC('month', f.forecast_for_month)
       ORDER BY month`,
    );
    const chartRows = new Map();
    for (const row of actualChartResult.rows) {
      const key = String(row.month).slice(0, 10);
      chartRows.set(key, {
        month: key,
        actualConsumption: row.actualConsumption === null ? null : Number(row.actualConsumption),
        projectedConsumption: null,
        actualWaterBill: row.actualWaterBill === null ? null : Number(row.actualWaterBill),
        projectedWaterBill: null,
      });
    }
    for (const row of forecastChartResult.rows) {
      const key = String(row.month).slice(0, 10);
      const existing = chartRows.get(key) || {
        month: key,
        actualConsumption: null,
        projectedConsumption: null,
        actualWaterBill: null,
        projectedWaterBill: null,
      };
      chartRows.set(key, {
        ...existing,
        projectedConsumption: row.projectedConsumption === null ? null : Number(row.projectedConsumption),
        projectedWaterBill: row.projectedWaterBill === null ? null : Number(row.projectedWaterBill),
      });
    }
    return res.json({
      evaluationMonth,
      metrics: { ...calculateAccuracy(eligible), excludedCount: diagnostics.length - eligible.length },
      latestForecast: latestForecastResult.rows[0] || { total: 0, ready: 0, excluded: 0, forecastForMonth: null },
      chartSeries: [...chartRows.values()].sort((a, b) => a.month.localeCompare(b.month)),
      diagnostics,
      flaggedReadings: flaggedResult.rows,
    });
  } catch (error) { return next(error); }
});

router.get("/units/:id", allowRoles("ADMIN", "COLLECTOR"), requireId, async (req, res, next) => {
  try {
    const unitResult = await pool.query("SELECT id, unit_number AS \"unitNumber\" FROM units WHERE id = $1", [req.resourceId]);
    if (!unitResult.rows[0]) return res.status(404).json({ message: "Unit not found." });
    const [historyResult, forecastsResult] = await Promise.all([
      pool.query(`${historySelect} WHERE m.unit_id = $1 AND (p.analytics_only = FALSE OR p.readings_visible_at IS NOT NULL) ORDER BY p.period_start`, [req.resourceId]),
      pool.query(`${forecastSelect} WHERE f.unit_id = $1 AND (p.analytics_only = FALSE OR p.readings_visible_at IS NOT NULL) ORDER BY f.forecast_for_month`, [req.resourceId]),
    ]);
    return res.json({ unit: unitResult.rows[0], history: historyResult.rows, forecasts: forecastsResult.rows });
  } catch (error) { return next(error); }
});

export default router;
