import { writeAuditLog } from './auditLog.js';

// SMTP cannot be rolled back. Result states commit together; the shared writer excludes automatic changes from user activity.
export async function saveDeliveryOutcomes(database, outcomes, { reminder = false } = {}) {
  if (!outcomes.length) return { sent: 0, failed: 0 };
  const client = typeof database.connect === 'function' ? await database.connect() : database;
  const table = reminder ? 'soa_reminder_deliveries' : 'soa_email_deliveries';
  const expected = reminder ? 'PROCESSING' : 'PENDING';
  try {
    await client.query('BEGIN');
    const affected = [];
    for (const { delivery, error } of outcomes) {
      const status = error ? 'FAILED' : 'SENT';
      const result = await client.query(`UPDATE ${table} SET status = $2,
        sent_at=CASE WHEN $2='SENT' THEN NOW() ELSE sent_at END,
        last_error=$3${reminder ? '' : ', attempt_count=attempt_count+1,last_attempted_at=NOW()'}
        WHERE id=$1 AND status=$4 RETURNING id`, [delivery.id, status, error ? 'Email delivery failed.' : null, expected]);
      if (!result.rows.length) continue;
      affected.push({ entityName: 'SOA_EMAIL_DELIVERY', entityId: delivery.id, unitNumber: delivery.unitNumber,
        fullName: delivery.recipientName, billId: delivery.billId, periodStart: delivery.periodStart, periodEnd: delivery.periodEnd,
        before: { status: expected }, after: { status } });
    }
    const sent = affected.filter(row => row.after.status === 'SENT').length;
    const failed = affected.length - sent;
    if (affected.length) await writeAuditLog({ client, entityName: 'SOA_EMAIL_DELIVERY', action: reminder ? 'REMINDER_DELIVERY' : 'DELIVERY_COMPLETED',
      newValues: { sent, failed }, context: { target: { label: reminder ? 'SOA reminders' : 'SOA email deliveries' }, affectedRecords: affected, counts: { sent, failed } } });
    await client.query('COMMIT');
    return { sent, failed };
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { if (client !== database) client.release(); }
}
