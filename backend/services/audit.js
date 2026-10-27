import pool from '../config/db.js';

// Central audit service. Use the numbered sections below to find related code.
// Sections use region markers so they can be folded in the editor.
// 1. Snapshot sanitization and change detection
// 2. Record identity and context enrichment
// 3. Activity feed summaries and detail responses
// 4. Batch snapshots and affected-record comparisons
// 5. Historical identity recovery
// 6. Transaction-aware audit writer
// 7. Email delivery outcome persistence
// 8. Route audit coverage registry

// #region 1. Snapshot sanitization and change detection

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

// #endregion

// #region 2. Record identity and context enrichment

const pick = (data, ...keys) => keys.map(key => data?.[key]).find(value => value !== undefined && value !== null);
export function auditTarget(entityName, entityId, data = {}) {
  const target = { entityName, entityId };
  const fields = {
    unitId: ['unitId', 'unit_id'], unitNumber: ['unitNumber', 'unit_number', 'unit_number_snapshot'],
    fullName: ['fullName', 'payer_name_snapshot', 'residentName', 'full_name', 'userName', 'payerName'],
    email: ['email', 'payer_email_snapshot', 'residentEmail'], userId: ['userId', 'user_id'],
    periodStart: ['periodStart', 'period_start', 'period_start_snapshot'], periodEnd: ['periodEnd', 'period_end', 'period_end_snapshot'],
    dueDate: ['dueDate', 'due_date', 'due_date_snapshot'], paymentReference: ['paymentReference', 'officialReceiptNo', 'official_receipt_no'],
    amount: ['verifiedAmount', 'verified_amount', 'amount'], detectedAmount: ['ocrAmount', 'ocr_amount'],
    paymentPurpose: ['paymentPurpose', 'payment_purpose'], paymentMethod: ['paymentMethod', 'payment_method'],
    reviewStatus: ['reviewStatus', 'review_status'], relationshipType: ['relationshipType', 'relationship_type'],
    recommendationType: ['recommendationType', 'recommendation_type'], category: ['category'],
    billId: ['targetBillId', 'target_unit_bill_id', 'unit_bill_id', 'billId'],
    periodId: ['periodId', 'billingPeriodId', 'billing_period_id', 'basedOnPeriodId', 'based_on_period_id'], periodMonth: ['periodMonth'],
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
  const tables = { USER_ACCOUNT: 'users', UNIT: 'units', UNIT_ASSIGNMENT: 'unit_assignments', BILLING_PERIOD: 'billing_periods', ANALYTICS_IMPORT: 'billing_periods', UNIT_BILL: 'unit_bills', SOA_EMAIL_DELIVERY: 'unit_bills', PAYMENT_SUBMISSION: 'payment_submissions', BILLING_ERROR_REPORT: 'billing_error_reports', PRESCRIPTIVE_RECOMMENDATION: 'prescriptive_recommendations' };
  const target = auditTarget(entityName, entityId, data);
  const hasIdentity = target.unitNumber || target.fullName || (target.periodStart && target.periodEnd);
  if ((!hasIdentity || entityName === 'PAYMENT_SUBMISSION') && entityId && tables[entityName]) {
    const result = await client.query(`SELECT to_jsonb(record) AS snapshot FROM ${tables[entityName]} record WHERE id=$1`, [entityId]);
    data = { ...result.rows[0]?.snapshot, ...data };
  }
  let identity = auditTarget(entityName, entityId, data);
  if (identity.billId && (!identity.unitNumber || !identity.fullName || !identity.periodStart || !identity.periodEnd)) {
    const bill = (await client.query('SELECT to_jsonb(b) AS snapshot FROM unit_bills b WHERE id=$1', [identity.billId])).rows[0]?.snapshot;
    identity = { ...auditTarget(entityName, entityId, bill), ...identity };
  }
  if (identity.unitId && !identity.unitNumber) {
    const unit = (await client.query('SELECT unit_number FROM units WHERE id=$1', [identity.unitId])).rows[0];
    if (unit) identity.unitNumber = unit.unit_number;
  }
  if (identity.periodId && (!identity.periodStart || !identity.periodEnd)) {
    const period = (await client.query('SELECT to_jsonb(p) AS snapshot FROM billing_periods p WHERE id=$1', [identity.periodId])).rows[0]?.snapshot;
    identity = { ...auditTarget(entityName, entityId, period), ...identity };
  }
  if (identity.userId && !identity.fullName) {
    const user = (await client.query('SELECT full_name FROM users WHERE id=$1', [identity.userId])).rows[0];
    if (user) identity.fullName = user.full_name;
  }
  return sanitizeAudit({ version: 1, origin: actorUserId ? 'USER' : 'SYSTEM', ...context, target: { ...identity, ...context.target } });
}

// #endregion

// #region 3. Activity feed summaries and detail responses

// Small, explicitly allowed changes for the summary feed; never return whole
// before/after records or arbitrary nested values in the list response.
export function auditSummaryChanges(before, after) {
  if (!before || !after) return [];
  const changes = [];
  const fields = {
    fullName: ['fullName', 'full_name'], email: ['email'], role: ['role'],
    isActive: ['isActive', 'is_active'], approvalStatus: ['approvalStatus', 'approval_status'],
    unitNumber: ['unitNumber', 'unit_number'], floor: ['floor'], billableAreaSqm: ['billableAreaSqm', 'billable_area_sqm'], occupancyStatus: ['occupancyStatus', 'occupancy_status'],
    periodStart: ['periodStart', 'period_start'], periodEnd: ['periodEnd', 'period_end'], dueDate: ['dueDate', 'due_date'],
    waterRatePerCubicM: ['waterRatePerCubicM', 'water_rate_per_cubic_m'], associationDuesRatePerSqm: ['associationDuesRatePerSqm', 'association_dues_rate_per_sqm'], latePenaltyPercent: ['latePenaltyPercent', 'late_penalty_percent'],
    status: ['status'], reviewStatus: ['reviewStatus', 'review_status'], verifiedAmount: ['verifiedAmount', 'verified_amount'],
    verifiedReferenceNo: ['verifiedReferenceNo', 'verified_reference_no'], paymentMethod: ['paymentMethod', 'payment_method'],
    previousReading: ['previousReading', 'previous_reading'], currentReading: ['currentReading', 'current_reading'],
    relationshipType: ['relationshipType', 'relationship_type'], isPrimaryPayer: ['isPrimaryPayer', 'is_primary_payer'],
  };
  for (const [field, aliases] of Object.entries(fields)) {
    const oldKey = aliases.find(key => Object.hasOwn(before, key)), newKey = aliases.find(key => Object.hasOwn(after, key));
    if (!oldKey || !newKey) continue;
    const previous = before[oldKey], next = after[newKey];
    if ((previous !== null && typeof previous === 'object') || (next !== null && typeof next === 'object')) continue;
    if (!sameAuditValues(previous, next)) changes.push({ field, before: previous, after: next });
  }
  if (Array.isArray(before.invoices) && Array.isArray(after.invoices)) {
    for (const invoice of after.invoices) {
      if (!['WATER', 'ASSOCIATION_DUES'].includes(invoice.chargeType)) continue;
      const previous = before.invoices.find(row => row.chargeType === invoice.chargeType);
      if (!previous || !Object.hasOwn(previous, 'invoiceNumber') || !Object.hasOwn(invoice, 'invoiceNumber')) continue;
      if ([previous?.invoiceNumber, invoice.invoiceNumber].some(value => value != null && typeof value !== 'string')) continue;
      if (previous && previous.invoiceNumber !== invoice.invoiceNumber) changes.push({ field: 'invoiceNumber', category: invoice.chargeType, before: previous.invoiceNumber ?? null, after: invoice.invoiceNumber ?? null });
    }
  }
  return sanitizeAudit(changes);
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
  const affectedCount = context.affectedCount ?? (affectedRecords.length || legacyIds.length);
  const publication = log.entityName === 'BILLING_PERIOD' && ['PUBLISHED', 'UNPUBLISHED'].includes(log.action);
  // The compact feed needs saved resident/unit identities, not whole financial
  // snapshots. Bound the preview; the detail endpoint retains the complete list.
  const affectedTargets = publication ? affectedRecords.slice(0, 3).map(record => {
    const identity = auditTarget('UNIT_BILL', record.entityId ?? record.id, { ...record.before, ...record.after, ...record });
    return Object.fromEntries(['entityName', 'entityId', 'fullName', 'unitNumber', 'periodStart', 'periodEnd']
      .filter(key => identity[key] !== undefined && (typeof identity[key] === 'string' || typeof identity[key] === 'number'))
      .map(key => [key, identity[key]]));
  }) : [];
  if (publication && affectedCount > 0) counts[log.action === 'PUBLISHED' ? 'publishedCount' : 'unpublishedCount'] ??= affectedCount;
  const changes = auditSummaryChanges(oldValues, newValues);
  const result = { ...log, oldValues: undefined, newValues: undefined, remarks: sanitizeAudit(log.remarks), context: { version: context.version || 0, origin: context.origin, target, counts, changes: changes.slice(0, 3), changeCount: changes.length, affectedCount, affectedTargets } };
  if (detail) {
    result.oldValues = oldValues; result.newValues = newValues;
    result.context = { ...context, ...result.context, affectedRecords: affectedRecords.length ? affectedRecords : legacyIds.map(id => ({ entityName: 'UNIT_BILL', entityId: id })) };
  }
  return result;
}

// #endregion

// #region 4. Batch snapshots and affected-record comparisons

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

// #endregion

// #region 5. Historical identity recovery

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

// #endregion

// #region 6. Transaction-aware audit writer

function dbClient(client) {
  return client?.query ? client : pool;
}

export async function writeAuditLog({
  client,
  actorUserId = null,
  entityName,
  entityId = null,
  action,
  oldValues = null,
  newValues = null,
  remarks = null,
  context = {},
}) {
  // Activity Log is reserved for changes initiated by an identified user.
  if (!actorUserId || context.origin === 'SYSTEM') return false;
  oldValues = sanitizeAudit(oldValues);
  newValues = sanitizeAudit(newValues);
  if (oldValues && newValues && ['UPDATE', 'UPDATE_PROFILE', 'EDIT_INVOICES', 'PAYMENT_REFERENCES_UPDATED', 'SOA_EDITED'].includes(action) && sameAuditValues(oldValues, newValues)) return false;
  const database = dbClient(client);
  context = await enrichAuditContext(database, { actorUserId, entityName, entityId, oldValues, newValues, context });
  await database.query(
    `INSERT INTO audit_logs
      (actor_user_id, actor_name_snapshot, actor_role_snapshot, entity_name, entity_id, action, old_values, new_values, remarks, context)
     VALUES (
       $1,
       (SELECT full_name FROM users WHERE id = $1),
       (SELECT role FROM users WHERE id = $1),
       $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::jsonb
     )`,
    [
      actorUserId,
      entityName,
      entityId,
      action,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      remarks,
      JSON.stringify(context),
    ],
  );
  return true;
}

// #endregion

// #region 7. Email delivery outcome persistence

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

// #endregion

// #region 8. Route audit coverage registry

// Every new mutation route must declare its audit contract here. Covered routes
// commit a business audit; excluded routes only manipulate temporary or UI state.
export const auditCoverage = {
  accountRoutes: { recorded: ['PATCH /profile', 'POST /email-change/verify'], excluded: ['POST /email-change'] },
  analyticsImportRoutes: { recorded: ['POST /', 'DELETE /:periodMonth', 'DELETE /'], excluded: ['POST /preview'] },
  analyticsRoutes: { recorded: ['POST /refresh-forecasts'] },
  authRoutes: { recorded: ['POST /register', 'POST /reset-password', 'POST /change-password', 'GET /verify-email'], excluded: ['POST /login', 'POST /forgot-password', 'POST /verify-password-reset-otp', 'POST /resend-verification'] },
  registrationRoutes: { excluded: ['POST /register/send-otp', 'POST /register/verify-otp'] },
  billingErrorRoutes: { recorded: ['POST /bills/:id', 'PATCH /:id/resolve'] },
  billingPeriodRoutes: { recorded: ['POST /', 'PATCH /:id', 'PUT /:id/readings', 'POST /:id/generate', 'POST /:id/reopen', 'POST /:id/forward', 'POST /:id/publish', 'POST /:id/unpublish', 'POST /:id/unpublish-selected', 'POST /:id/bills/:billId/unpublish', 'POST /:id/bills/:billId/email-deliveries/retry', 'POST /:id/bills/:billId/email-deliveries/resend', 'DELETE /:id'], excluded: ['POST /:id/readings/preview'] },
  billRoutes: { recorded: ['PATCH /:id/payment-references', 'PATCH /:id'] },
  // Protected exports are downloads, not saved business changes. Their temporary
  // operational state must never enter Activity Log (especially email/PDF data).
  soaExportRoutes: { excluded: ['POST /bills/:id/protected-exports', 'GET /bills/:id/protected-exports', 'GET /soa-exports/:exportId', 'GET /soa-exports/:exportId/file'] },
  notificationRoutes: { excluded: ['PATCH /read-all', 'PATCH /:id/read'] },
  paymentRoutes: { recorded: ['POST /bills/:id', 'POST /manual', 'PATCH /:id/invoice-references', 'POST /:id/review', 'DELETE /:id'], excluded: ['POST /bills/:id/preview', 'POST /allocation-preview'] },
  prescriptiveRecommendationRoutes: { recorded: ['PATCH /:id/view', 'DELETE /:id'] },
  soaTemplateRoutes: { recorded: ['PATCH /', 'POST /assets/:type'] },
  userRoutes: { recorded: ['POST /', 'PATCH /:id', 'DELETE /:id'] },
  unitRoutes: { recorded: ['POST /', 'PATCH /:id', 'DELETE /:id'] },
  unitAssignmentRoutes: { recorded: ['POST /', 'PATCH /:id', 'DELETE /:id'] },
};

// #endregion
