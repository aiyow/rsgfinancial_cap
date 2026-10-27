import { auditTarget, sanitizeAudit } from './auditDetails.js';

const beforeOrEqual = (row, log) => {
  const difference = new Date(row.createdAt).getTime() - new Date(log.createdAt).getTime();
  return difference < 0 || (difference === 0 && BigInt(row.id) <= BigInt(log.id));
};
const recordKey = log => `${log.entityName}:${log.entityId}`;
const identity = log => ({ ...auditTarget(log.entityName, log.entityId, { ...sanitizeAudit(log.oldValues), ...sanitizeAudit(log.newValues) }), ...sanitizeAudit(log.context?.target || {}) });

// Recover identifiers from saved history, never from today's resident assignment
// or today's payment status/amount. Existing event snapshots always take priority.
export async function recoverAuditIdentities(client, logs) {
  const records = [...new Map(logs.filter(log => log.entityId != null).map(log => [recordKey(log), log])).values()];
  if (!records.length) return logs;
  const history = (await client.query(`SELECT h.id, h.created_at AS "createdAt", h.entity_name AS "entityName", h.entity_id AS "entityId", h.action,
    h.actor_name_snapshot AS "actorName", h.actor_role_snapshot AS "actorRole", h.old_values AS "oldValues", h.new_values AS "newValues", h.context
    FROM audit_logs h JOIN UNNEST($1::varchar[], $2::bigint[]) AS wanted(entity_name, entity_id)
      ON h.entity_name=wanted.entity_name AND h.entity_id=wanted.entity_id
    ORDER BY h.created_at, h.id`, [records.map(log => log.entityName), records.map(log => log.entityId)])).rows;
  const byRecord = new Map();
  for (const row of history) {
    const key = recordKey(row);
    if (!byRecord.has(key)) byRecord.set(key, []);
    byRecord.get(key).push(row);
  }
  const resolved = logs.map(log => {
    let target = {};
    for (const row of byRecord.get(recordKey(log)) || []) {
      if (!beforeOrEqual(row, log)) continue;
      const saved = identity(row);
      if (row.entityName === 'PAYMENT_SUBMISSION' && row.action === 'SUBMIT' && row.actorRole === 'RESIDENT' && !saved.fullName) saved.fullName = row.actorName;
      target = { ...target, ...saved };
    }
    return { ...log, context: { ...log.context, target: { ...target, ...identity(log) } } };
  });
  const billIds = [...new Set(resolved.map(log => log.context.target.billId || (['UNIT_BILL', 'SOA_EMAIL_DELIVERY'].includes(log.entityName) ? log.entityId : null)).filter(id => /^\d+$/.test(String(id))))];
  const bills = billIds.length ? (await client.query('SELECT b.id, to_jsonb(b) AS snapshot FROM unit_bills b WHERE b.id=ANY($1::bigint[])', [billIds])).rows : [];
  const billMap = new Map(bills.map(row => [String(row.id), row.snapshot]));
  return resolved.map(log => {
    const target = log.context.target;
    const bill = billMap.get(String(target.billId || (['UNIT_BILL', 'SOA_EMAIL_DELIVERY'].includes(log.entityName) ? log.entityId : '')));
    // Only the SOA's saved identity/coverage fields, not mutable financial totals.
    const saved = bill ? auditTarget(log.entityName, log.entityId, { unit_number_snapshot: bill.unit_number_snapshot, payer_name_snapshot: bill.payer_name_snapshot, period_start_snapshot: bill.period_start_snapshot, period_end_snapshot: bill.period_end_snapshot }) : {};
    return { ...log, context: { ...log.context, target: { ...saved, ...target } } };
  });
}
