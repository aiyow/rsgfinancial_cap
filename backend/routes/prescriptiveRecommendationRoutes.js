import express from 'express';
import { z } from 'zod';
import pool from '../config/db.js';
import { allowRoles, requireAuth } from '../middleware/authMiddleware.js';
import { requireId, validateBody } from '../middleware/validate.js';
import { writeAuditLog } from '../services/auditLog.js';
import { ensurePrescriptiveAnalyticsSchema, regeneratePrescriptiveRecommendations, RECOMMENDATION_TYPES } from '../services/prescriptiveAnalytics.js';

const router = express.Router();
const statuses = new Set(['ACTIVE', 'ALL', 'OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED', 'SUPERSEDED']);
const priorities = new Set(['ALL', 'HIGH', 'MEDIUM']);
const actionSchema = z.object({
  action: z.enum(['ACKNOWLEDGED', 'RESOLVED', 'DISMISSED', 'SHARED_WITH_RESIDENT']),
  note: z.string().trim().max(500).optional(),
}).strict();

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

function activeStatus(value) {
  return value === 'OPEN' || value === 'ACKNOWLEDGED';
}

function actionMessage(action) {
  return {
    ACKNOWLEDGED: 'Recommendation acknowledged.',
    RESOLVED: 'Recommendation resolved.',
    DISMISSED: 'Recommendation dismissed.',
    SHARED_WITH_RESIDENT: 'High-usage notice shared with the Resident.',
  }[action];
}

router.use(requireAuth);

router.get('/resident', allowRoles('RESIDENT'), async (req, res, next) => {
  try {
    await regeneratePrescriptiveRecommendations(pool);
    const result = await pool.query(
      `${recommendationSelect}
       JOIN unit_assignments a ON a.unit_id = r.unit_id
       WHERE a.user_id = $1 AND a.end_date IS NULL
         AND r.recommendation_type = $2
         AND r.resident_visible_at IS NOT NULL
         AND r.status = ANY($3::varchar[])
       ORDER BY r.updated_at DESC, u.unit_number`,
      [req.user.id, RECOMMENDATION_TYPES.CHECK_HIGH_USAGE, ['OPEN', 'ACKNOWLEDGED']],
    );
    return res.json({ recommendations: result.rows });
  } catch (error) { return next(error); }
});

router.get('/', allowRoles('ADMIN', 'COLLECTOR'), async (req, res, next) => {
  try {
    const requestedStatus = String(req.query.status || 'ACTIVE').trim().toUpperCase();
    const requestedPriority = String(req.query.priority || 'ALL').trim().toUpperCase();
    if (!statuses.has(requestedStatus) || !priorities.has(requestedPriority)) {
      return res.status(400).json({ message: 'Use a valid recommendation status and priority.' });
    }
    await regeneratePrescriptiveRecommendations(pool);
    const params = [];
    const conditions = [];
    if (requestedStatus === 'ACTIVE') {
      params.push(['OPEN', 'ACKNOWLEDGED']);
      conditions.push(`r.status = ANY($${params.length}::varchar[])`);
    } else if (requestedStatus !== 'ALL') {
      params.push(requestedStatus);
      conditions.push(`r.status = $${params.length}`);
    }
    if (requestedPriority !== 'ALL') {
      params.push(requestedPriority);
      conditions.push(`r.priority = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(
      `${recommendationSelect} ${where}
       ORDER BY CASE r.priority WHEN 'HIGH' THEN 0 ELSE 1 END, r.updated_at DESC, u.unit_number`,
      params,
    );
    return res.json({ recommendations: result.rows });
  } catch (error) { return next(error); }
});

router.patch('/:id', allowRoles('ADMIN', 'COLLECTOR'), requireId, validateBody(actionSchema), async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await ensurePrescriptiveAnalyticsSchema(client);
    const existing = await client.query(
      `SELECT id, unit_id AS "unitId", based_on_period_id AS "basedOnPeriodId",
        recommendation_type AS "recommendationType", priority, status, message, evidence,
        resident_visible_at AS "residentVisibleAt", resident_visible_by AS "residentVisibleBy"
       FROM prescriptive_recommendations WHERE id = $1 FOR UPDATE`,
      [req.resourceId],
    );
    const recommendation = existing.rows[0];
    if (!recommendation) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Recommendation not found.' });
    }

    const { action, note } = req.validatedBody;
    if (!activeStatus(recommendation.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Only active recommendations can be updated.' });
    }
    if (action === 'ACKNOWLEDGED' && recommendation.status !== 'OPEN') {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'This recommendation was already acknowledged.' });
    }
    if (action === 'SHARED_WITH_RESIDENT') {
      if (recommendation.recommendationType !== RECOMMENDATION_TYPES.CHECK_HIGH_USAGE) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Only high-usage recommendations can be shared with a Resident.' });
      }
      if (recommendation.residentVisibleAt) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'This notice was already shared with the Resident.' });
      }
    }

    const before = { ...recommendation };
    let update;
    if (action === 'SHARED_WITH_RESIDENT') {
      update = await client.query(
        `UPDATE prescriptive_recommendations
         SET resident_visible_at = NOW(), resident_visible_by = $2, updated_at = NOW()
         WHERE id = $1`,
        [req.resourceId, req.user.id],
      );
    } else {
      update = await client.query(
        `UPDATE prescriptive_recommendations
         SET status = $2, updated_at = NOW()
         WHERE id = $1`,
        [req.resourceId, action],
      );
    }
    if (update.rowCount !== 1) throw new Error('Recommendation update failed.');

    await client.query(
      `INSERT INTO prescriptive_recommendation_actions (recommendation_id, actor_id, action, note)
       VALUES ($1, $2, $3, $4)`,
      [req.resourceId, req.user.id, action, note || null],
    );
    const afterResult = await client.query(`${recommendationSelect} WHERE r.id = $1`, [req.resourceId]);
    const after = afterResult.rows[0];
    await writeAuditLog({
      client,
      actorUserId: req.user.id,
      entityName: 'PRESCRIPTIVE_RECOMMENDATION',
      entityId: req.resourceId,
      action,
      oldValues: before,
      newValues: after,
      remarks: note || actionMessage(action),
    });
    await client.query('COMMIT');
    return res.json({ message: actionMessage(action), recommendation: after });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return next(error);
  } finally { client?.release(); }
});

export default router;
