import express from 'express';
import pool from '../config/db.js';
import { allowRoles, requireAuth } from '../middleware/authMiddleware.js';
import { requireId } from '../middleware/validate.js';
import { presentAudit } from '../services/auditDetails.js';
import { isBillingDate } from '../services/billingPeriodPolicy.js';

const router = express.Router();
router.use(requireAuth, allowRoles('ADMIN'));
const actorRole = "COALESCE(a.actor_role_snapshot, usr.role, CASE WHEN a.context->>'origin'='SYSTEM' OR (a.actor_user_id IS NULL AND a.action='ASSOCIATION_PENALTY_RECALCULATED') THEN 'SYSTEM' ELSE 'UNKNOWN' END)";
const actorName = "COALESCE(a.actor_name_snapshot, usr.full_name, CASE WHEN " + actorRole + "='SYSTEM' THEN 'System' ELSE 'Unknown actor' END)";
const userActivity = "COALESCE(a.context->>'origin','USER')<>'SYSTEM' AND " + actorRole + " IN ('ADMIN','COLLECTOR','RESIDENT')";
const select = 'SELECT \'AUDIT_LOG\' AS source, a.id, a.created_at AS "createdAt", a.entity_name AS "entityName", a.entity_id AS "entityId", a.action, a.remarks, a.old_values AS "oldValues", a.new_values AS "newValues", a.context, a.actor_user_id AS "actorUserId", ' + actorName + ' AS "actorName", ' + actorRole + ' AS "actorRole" FROM audit_logs a LEFT JOIN users usr ON usr.id=a.actor_user_id';

router.get('/', async (req, res, next) => {
  try {
    const page = Number(req.query.page || 1), pageSize = Number(req.query.pageSize || 10);
    if (!Number.isSafeInteger(page) || page < 1 || ![10, 25, 50].includes(pageSize)) return res.status(400).json({ message: 'Use a positive page and a page size of 10, 25 or 50.' });
    const { from, to } = req.query;
    if ((from && !isBillingDate(from)) || (to && !isBillingDate(to)) || (from && to && from > to)) return res.status(400).json({ message: 'Choose a valid date range.' });
    const values = [], conditions = [userActivity];
    const bind = value => { values.push(value); return '$' + values.length; };
    if (req.query.entity) conditions.push('a.entity_name=' + bind(String(req.query.entity).trim().toUpperCase()));
    if (req.query.action) {
      const action = String(req.query.action).trim().toUpperCase();
      if (['DELETE', 'DELETED'].includes(action)) conditions.push("a.action IN ('DELETE','DELETED')");
      else {
        const param = bind(action);
        conditions.push(action === 'SUBMIT' ? "(a.action=" + param + " OR (a.entity_name='BILLING_ERROR_REPORT' AND a.action='CREATE'))" : 'a.action=' + param);
      }
    }
    if (req.query.actorRole) {
      const role = String(req.query.actorRole).toUpperCase();
      if (!['ADMIN', 'COLLECTOR', 'RESIDENT'].includes(role)) return res.status(400).json({ message: 'Choose a valid user role.' });
      conditions.push(actorRole + '=' + bind(role));
    }
    if (req.query.actorId) {
      if (!/^\d+$/.test(String(req.query.actorId))) return res.status(400).json({ message: 'Choose a valid actor.' });
      conditions.push('a.actor_user_id=' + bind(req.query.actorId));
    }
    if (from) conditions.push("a.created_at >= (" + bind(from) + "::date::timestamp AT TIME ZONE 'Asia/Manila')");
    if (to) conditions.push("a.created_at < ((" + bind(to) + "::date + 1)::timestamp AT TIME ZONE 'Asia/Manila')");
    const search = String(req.query.q || '').trim().slice(0, 200);
    if (search) {
      const param = bind('%' + search.replace(/[\\%_]/g, '\\$&') + '%');
      conditions.push("(concat_ws(' '," + actorName + ",a.entity_name,a.entity_id::text,a.action,a.remarks,a.context->'target'->>'label',a.context->'target'->>'unitNumber',a.context->'target'->>'paymentReference',a.context->'target'->>'fullName',a.context->'target'->>'periodStart',a.context->'target'->>'periodEnd',a.old_values->>'periodStart',a.old_values->>'periodEnd',a.new_values->>'periodStart',a.new_values->>'periodEnd',a.old_values->>'unitNumber',a.new_values->>'unitNumber',a.old_values->>'fullName',a.new_values->>'fullName',a.old_values->>'email',a.new_values->>'email',a.old_values->>'officialReceiptNo',a.new_values->>'officialReceiptNo',a.old_values->>'ocrReferenceNo',a.new_values->>'ocrReferenceNo',a.old_values->>'verifiedReferenceNo',a.new_values->>'verifiedReferenceNo') ILIKE " + param +
        " OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.context->'affectedRecords')='array' THEN a.context->'affectedRecords' ELSE '[]'::jsonb END) r WHERE concat_ws(' ',r->>'unitNumber',r->>'fullName',r->>'entityId') ILIKE " + param + "))");
    }
    const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
    const source = ' FROM audit_logs a LEFT JOIN users usr ON usr.id=a.actor_user_id';
    const summary = (await pool.query('SELECT COUNT(*)::int AS total,' +
      "COUNT(*) FILTER(WHERE " + actorRole + "='ADMIN')::int AS admin," +
      "COUNT(*) FILTER(WHERE " + actorRole + "='COLLECTOR')::int AS collector," +
      "COUNT(*) FILTER(WHERE " + actorRole + "='RESIDENT')::int AS resident" + source + where, values)).rows[0];
    const pageCount = Math.max(1, Math.ceil(summary.total / pageSize)), safePage = Math.min(page, pageCount);
    const result = await pool.query(select + where + ' ORDER BY a.created_at DESC,a.id DESC LIMIT $' + (values.length + 1) + ' OFFSET $' + (values.length + 2), [...values, pageSize, (safePage - 1) * pageSize]);
    const facets = (await pool.query('SELECT ARRAY_AGG(DISTINCT a.entity_name ORDER BY a.entity_name) AS entities, ARRAY_AGG(DISTINCT a.action ORDER BY a.action) AS actions' + source + ' WHERE ' + userActivity)).rows[0];
    res.set('Cache-Control', 'no-store');
    return res.json({ logs: result.rows.map(log => presentAudit(log)), pagination: { page: safePage, pageSize, pageCount, total: summary.total }, summary, filters: { entities: facets.entities || [], actions: facets.actions || [] } });
  } catch (error) { return next(error); }
});

router.get('/:id', requireId, async (req, res, next) => {
  try {
    const result = await pool.query(select + ' WHERE a.id=$1 AND ' + userActivity, [req.resourceId]);
    if (!result.rows[0]) return res.status(404).json({ message: 'Activity entry not found.' });
    res.set('Cache-Control', 'no-store');
    return res.json({ log: presentAudit(result.rows[0], { detail: true }) });
  } catch (error) { return next(error); }
});
export default router;
