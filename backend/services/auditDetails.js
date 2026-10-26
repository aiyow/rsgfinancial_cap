// Only business snapshots belong in an audit record, never a request or database row dump.
const privateKey = /password|passphrase|secret|token|otp|hash|raw_?text|ocrRawText|workbook_?data|file_?data|buffer|public_?id|cloudinary|receipt_?path|(?:asset|receipt|signed|private|delivery).*url/i;
const technicalKey = /^(created_?at|updated_?at|recorded_?by|generated_?at|corrected_?at)$/i;

export function sanitizeAudit(value, depth = 0) {
  if (depth > 16 || value === undefined || typeof value === 'function') return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return undefined;
  if (Array.isArray(value)) return value.map(item => sanitizeAudit(item, depth + 1)).filter(item => item !== undefined);
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (privateKey.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    const safe = sanitizeAudit(item, depth + 1);
    if (safe !== undefined) result[key] = safe;
  }
  return result;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).filter(key => !technicalKey.test(key)).sort().map(key => [key, stable(value[key])]));
  return value;
}

export function sameAuditValues(before, after) {
  return JSON.stringify(stable(sanitizeAudit(before))) === JSON.stringify(stable(sanitizeAudit(after)));
}

const pick = (data, ...keys) => keys.map(key => data?.[key]).find(value => value !== undefined && value !== null);
export function auditTarget(entityName, entityId, data = {}) {
  const target = { entityName, entityId };
  const fields = {
    unitId: ['unitId', 'unit_id'], unitNumber: ['unitNumber', 'unit_number', 'unit_number_snapshot'],
    fullName: ['fullName', 'full_name', 'userName', 'residentName', 'payerName', 'payer_name_snapshot'],
    periodStart: ['periodStart', 'period_start', 'period_start_snapshot'], periodEnd: ['periodEnd', 'period_end', 'period_end_snapshot'],
    dueDate: ['dueDate', 'due_date', 'due_date_snapshot'], paymentReference: ['officialReceiptNo', 'official_receipt_no'],
    billId: ['targetBillId', 'target_unit_bill_id', 'unit_bill_id', 'billId'],
    periodId: ['billingPeriodId', 'billing_period_id'], periodMonth: ['periodMonth'],
    filename: ['originalFilename', 'receiptOriginalName', 'receipt_original_name'], type: ['type'],
  };
  for (const [key, aliases] of Object.entries(fields)) {
    const value = pick(data, ...aliases);
    if (value !== undefined) target[key] = value;
  }
  return target;
}

export async function enrichAuditContext(client, { actorUserId, entityName, entityId, oldValues, newValues, context = {} }) {
  let data = { ...oldValues, ...newValues };
  const tables = { USER_ACCOUNT: 'users', UNIT: 'units', BILLING_PERIOD: 'billing_periods', ANALYTICS_IMPORT: 'billing_periods', UNIT_BILL: 'unit_bills', SOA_EMAIL_DELIVERY: 'unit_bills', PAYMENT_SUBMISSION: 'payment_submissions', BILLING_ERROR_REPORT: 'billing_error_reports', PRESCRIPTIVE_RECOMMENDATION: 'prescriptive_recommendations' };
  const target = auditTarget(entityName, entityId, data);
  const hasIdentity = target.unitNumber || target.fullName || (target.periodStart && target.periodEnd);
  if (!hasIdentity && entityId && tables[entityName]) {
    const result = await client.query(`SELECT to_jsonb(record) AS snapshot FROM ${tables[entityName]} record WHERE id=$1`, [entityId]);
    data = { ...result.rows[0]?.snapshot, ...data };
  }
  let identity = auditTarget(entityName, entityId, data);
  if (identity.billId && !identity.unitNumber) {
    const bill = (await client.query('SELECT to_jsonb(b) AS snapshot FROM unit_bills b WHERE id=$1', [identity.billId])).rows[0]?.snapshot;
    identity = { ...auditTarget(entityName, entityId, bill), ...identity };
  }
  if (identity.unitId && !identity.unitNumber) {
    const unit = (await client.query('SELECT unit_number FROM units WHERE id=$1', [identity.unitId])).rows[0];
    if (unit) identity.unitNumber = unit.unit_number;
  }
  return sanitizeAudit({ version: 1, origin: actorUserId ? 'USER' : 'SYSTEM', ...context, target: { ...identity, ...context.target } });
}

export function presentAudit(log, { detail = false } = {}) {
  const oldValues = sanitizeAudit(log.oldValues);
  const newValues = sanitizeAudit(log.newValues);
  const context = sanitizeAudit(log.context || {});
  const target = { ...auditTarget(log.entityName, log.entityId, { ...oldValues, ...newValues }), ...context.target };
  const counts = { ...context.counts };
  for (const [key, value] of Object.entries({ ...oldValues, ...newValues })) {
    if (/Count$|^removedBills$|^removedAssignments$|^removedBillingErrorReports$|^unpublishedCount$/.test(key) && typeof value !== 'object') counts[key] = value;
  }
  const affectedRecords = context.affectedRecords || oldValues?.bills?.map(row => ({ ...auditTarget('UNIT_BILL', row.id, row), before: row, after: newValues?.publishedAt === null || log.action === 'UNPUBLISHED' ? { publishedAt: null, publishedBy: null } : null })) || [];
  const legacyIds = newValues?.billIds || [];
  const result = { ...log, oldValues: undefined, newValues: undefined, remarks: sanitizeAudit(log.remarks), context: { version: context.version || 0, origin: context.origin, target, counts, affectedCount: context.affectedCount ?? (affectedRecords.length || legacyIds.length) } };
  if (detail) {
    result.oldValues = oldValues; result.newValues = newValues;
    result.context = { ...context, ...result.context, affectedRecords: affectedRecords.length ? affectedRecords : legacyIds.map(id => ({ entityName: 'UNIT_BILL', entityId: id })) };
  }
  return result;
}

export async function auditBatchRecords(client, periodId) {
  const result = await client.query('SELECT to_jsonb(b) AS snapshot, (SELECT jsonb_agg(to_jsonb(c)) FROM bill_charges c WHERE c.unit_bill_id=b.id) AS charges FROM unit_bills b WHERE b.billing_period_id=$1 ORDER BY b.id', [periodId]);
  return result.rows.map(({ snapshot, charges }) => ({ ...auditTarget('UNIT_BILL', snapshot.id, snapshot), id: snapshot.id,
    publishedAt: snapshot.published_at, publishedBy: snapshot.published_by,
    previousReading: snapshot.previous_reading_snapshot, currentReading: snapshot.current_reading_snapshot,
    soaRevision: snapshot.soa_revision, charges: charges?.map(row => ({ chargeType: row.charge_type, quantity: row.quantity, rateApplied: row.rate_applied, amount: row.amount })) }));
}

export async function auditReadings(client, periodIds) {
  const result = await client.query(`SELECT m.unit_id AS "unitId", u.unit_number AS "unitNumber", m.billing_period_id AS "periodId",
    m.previous_reading AS "previousReading", m.current_reading AS "currentReading", m.validation_status AS "validationStatus"
    FROM meter_readings m JOIN units u ON u.id=m.unit_id WHERE m.billing_period_id=ANY($1::bigint[]) ORDER BY m.billing_period_id, u.unit_number`, [periodIds]);
  return result.rows;
}

export function changedAuditRecords(before, after, { removed = false } = {}) {
  const key = row => `${row.periodId || ''}:${row.unitId || row.id}`;
  const old = new Map(before.map(row => [key(row), row]));
  const next = new Map(after.map(row => [key(row), row]));
  return [...new Set([...old.keys(), ...next.keys()])].flatMap(id => {
    const previous = old.get(id) || null, current = next.get(id) || null;
    if (sameAuditValues(previous, current)) return [];
    const row = current || previous;
    return [{ ...auditTarget(row.entityName || 'METER_READING', row.entityId || row.id || row.unitId, row), before: previous, after: removed ? null : current }];
  });
}
