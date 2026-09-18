import express from 'express';
import { z } from 'zod';
import pool from '../config/db.js';
import { allowRoles, requireAuth } from '../middleware/authMiddleware.js';
import { requireId, validateBody } from '../middleware/validate.js';
import { ensureBillingErrorSchema } from '../services/billingErrors.js';
import { createUserNotifications } from '../services/notifications.js';
import { writeAuditLog } from '../services/auditLog.js';

const router = express.Router();
const categories = ['METER_READING', 'WATER_CHARGE', 'ASSOCIATION_DUES', 'PAYMENT_OR', 'OTHER'];
const createSchema = z.object({ category: z.enum(categories), description: z.string().trim().min(3).max(1500) }).strict();
const resolveSchema = z.object({ resolutionNote: z.string().trim().min(3).max(1500) }).strict();
const select = `SELECT r.id, r.unit_bill_id AS "billId", r.category, r.description, r.status,
  r.resolution_note AS "resolutionNote", r.created_at AS "createdAt", r.resolved_at AS "resolvedAt",
  b.unit_number_snapshot AS "unitNumber", b.period_start_snapshot AS "periodStart",
  reporter.full_name AS "reportedByName", r.reported_by AS "reportedBy",
  resolver.full_name AS "resolvedByName"
  FROM billing_error_reports r
  JOIN unit_bills b ON b.id = r.unit_bill_id
  JOIN users reporter ON reporter.id = r.reported_by
  LEFT JOIN users resolver ON resolver.id = r.resolved_by`;

router.use(requireAuth);

router.post('/bills/:id', allowRoles('RESIDENT'), requireId, validateBody(createSchema), async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await ensureBillingErrorSchema(client);
    const bill = await client.query(
      `SELECT b.id, b.unit_id FROM unit_bills b JOIN billing_periods p ON p.id = b.billing_period_id
       WHERE b.id = $1 AND b.published_at IS NOT NULL AND p.status IN ('FORWARDED', 'CLOSED')
         AND EXISTS (SELECT 1 FROM unit_assignments a WHERE a.unit_id = b.unit_id AND a.user_id = $2 AND a.end_date IS NULL)`,
      [req.resourceId, req.user.id],
    );
    if (!bill.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Published SOA not found.' }); }
    const inserted = await client.query(
      `INSERT INTO billing_error_reports (unit_bill_id, reported_by, category, description)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.resourceId, req.user.id, req.validatedBody.category, req.validatedBody.description],
    );
    const staff = await client.query("SELECT id, role FROM users WHERE is_active = TRUE AND role IN ('ADMIN', 'COLLECTOR')");
    await createUserNotifications(client, staff.rows.map((user) => ({
      recipientUserId: user.id, type: 'BILLING_ERROR_REPORTED', title: 'Resident reported an SOA error',
      message: `A resident reported a ${req.validatedBody.category.replaceAll('_', ' ').toLowerCase()} issue.`,
      href: user.role === 'ADMIN' ? '/admin/billing-errors' : '/collector/billing-errors',
      dedupeKey: `billing-error:${inserted.rows[0].id}`,
    })));
    await writeAuditLog({ client, actorUserId: req.user.id, entityName: 'BILLING_ERROR_REPORT', entityId: inserted.rows[0].id, action: 'CREATE', newValues: req.validatedBody });
    await client.query('COMMIT');
    return res.status(201).json({ message: 'Your SOA error report was sent to the billing staff.', reportId: inserted.rows[0].id });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (error?.code === '23505') return res.status(409).json({ message: 'You already have an open error report for this SOA.' });
    return next(error);
  } finally { client?.release(); }
});

router.get('/', allowRoles('ADMIN', 'COLLECTOR'), async (req, res, next) => {
  try {
    await ensureBillingErrorSchema(pool);
    const status = String(req.query.status || 'OPEN').toUpperCase();
    if (!['OPEN', 'RESOLVED', 'ALL'].includes(status)) return res.status(400).json({ message: 'Invalid billing-error status.' });
    const result = await pool.query(`${select} ${status === 'ALL' ? '' : 'WHERE r.status = $1'} ORDER BY r.created_at DESC`, status === 'ALL' ? [] : [status]);
    return res.json({ reports: result.rows });
  } catch (error) { return next(error); }
});

router.patch('/:id/resolve', allowRoles('ADMIN', 'COLLECTOR'), requireId, validateBody(resolveSchema), async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await ensureBillingErrorSchema(client);
    const result = await client.query(
      `UPDATE billing_error_reports SET status = 'RESOLVED', resolution_note = $2, resolved_by = $3, resolved_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'OPEN' RETURNING id, unit_bill_id AS "billId", reported_by AS "reportedBy"`,
      [req.resourceId, req.validatedBody.resolutionNote, req.user.id],
    );
    if (!result.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Open billing-error report not found.' }); }
    const report = result.rows[0];
    await createUserNotifications(client, [{
      recipientUserId: report.reportedBy, type: 'BILLING_ERROR_RESOLVED', title: 'Your SOA error report was resolved',
      message: req.validatedBody.resolutionNote, href: `/resident/bills/${report.billId}`,
      dedupeKey: `billing-error-resolved:${report.id}`,
    }]);
    await writeAuditLog({ client, actorUserId: req.user.id, entityName: 'BILLING_ERROR_REPORT', entityId: report.id, action: 'RESOLVE', newValues: { resolutionNote: req.validatedBody.resolutionNote } });
    await client.query('COMMIT');
    return res.json({ message: 'Billing error report resolved.' });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return next(error);
  } finally { client?.release(); }
});

export default router;
