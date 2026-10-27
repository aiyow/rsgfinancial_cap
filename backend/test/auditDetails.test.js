import assert from 'node:assert/strict';
import test from 'node:test';
import { auditSummaryChanges, auditTarget, changedAuditRecords, presentAudit, sameAuditValues, sanitizeAudit, writeAuditLog, saveDeliveryOutcomes } from '../services/audit.js';

test('audit snapshots recursively exclude credentials, storage identifiers, file data and OCR text', () => {
  const dirty = { unitNumber: '232', password: 'private', password_hash: 'private', otp: 'private', accessToken: 'private', nested: [{ verifiedReferenceNo: 'GCASH-42', receiptCloudinaryPublicId: 'private', rawText: 'private', workbook_data: Buffer.from('private'), credentialChanged: true }], receiptPath: 'private', receiptUrl: 'private' };
  assert.deepEqual(sanitizeAudit(dirty), { unitNumber: '232', nested: [{ verifiedReferenceNo: 'GCASH-42', credentialChanged: true }] });
  assert.ok(!JSON.stringify(sanitizeAudit(dirty)).includes('private'));
});
test('no-op comparison ignores technical timestamps but preserves business status changes', () => {
  assert.equal(sameAuditValues({ rate: 23, updatedAt: 'old' }, { updatedAt: 'new', rate: 23 }), true);
  assert.equal(sameAuditValues({ publishedAt: null }, { publishedAt: '2026-10-26' }), false);
});
test('legacy deleted batch details use stored coverage and counts even with no current batch', () => {
  const log = { id: 2, entityName: 'BILLING_PERIOD', entityId: 42, action: 'DELETED', oldValues: { periodStart: '2026-10-05', periodEnd: '2026-11-05', billCount: 173, readingCount: 173, passwordHash: 'private' } };
  const row = presentAudit(log);
  assert.equal(row.context.target.periodStart, '2026-10-05'); assert.equal(row.context.counts.billCount, 173);
  assert.equal(row.oldValues, undefined);
  assert.ok(!JSON.stringify(presentAudit(log, { detail: true })).includes('private'));
  assert.equal(row.context.version, 0);
});
test('bulk reading diffs include actual changes and deletions, not identical units', () => {
  const before = [{ unitId: 1, unitNumber: '232', periodId: 42, currentReading: 100 }, { unitId: 2, unitNumber: '233', periodId: 42, currentReading: 110 }];
  const rows = changedAuditRecords(before, [{ ...before[0], currentReading: 101 }]);
  assert.equal(rows.length, 2); assert.equal(rows[0].before.currentReading, 100); assert.equal(rows[0].after.currentReading, 101); assert.equal(rows[1].after, null);
  assert.deepEqual(changedAuditRecords(before, before), []);
  assert.equal(auditTarget('PAYMENT_SUBMISSION', 174, { official_receipt_no: 'REF-0000174' }).paymentReference, 'REF-0000174');
});
test('common writer skips no-ops and sanitizes data before storage', async () => {
  const calls = [], client = { query: async (sql, values) => { calls.push({ sql, values }); return { rows: [] }; } };
  assert.equal(await writeAuditLog({ client, actorUserId: 1, entityName: 'UNIT', entityId: 1, action: 'UPDATE', oldValues: { unitNumber: '232' }, newValues: { unitNumber: '232', updatedAt: 'new' } }), false);
  assert.equal(calls.length, 0);
  await writeAuditLog({ client, actorUserId: 1, entityName: 'UNIT', entityId: 1, action: 'UPDATE', oldValues: { unitNumber: '232' }, newValues: { unitNumber: '233', password: 'private' } });
  assert.equal(calls.length, 1); assert.match(calls[0].sql, /context/);
  assert.ok(!JSON.stringify(calls[0].values).includes('private'));
  assert.equal(JSON.parse(calls[0].values[7]).target.unitNumber, '233');
});

test('summary changes allow only safe scalar fields and category invoice changes', () => {
  const before = { is_active: false, water_rate_per_cubic_m: 0, invoices: [{ chargeType: 'WATER', invoiceNumber: null }], password: 'private', receiptUrl: 'private', rawText: 'private', nested: { secret: 'private' } };
  const after = { isActive: true, waterRatePerCubicM: 23, invoices: [{ chargeType: 'WATER', invoiceNumber: 'INV-42' }], password: 'new-private', receiptUrl: 'new-private', rawText: 'new-private', nested: { secret: 'new-private' } };
  const changes = auditSummaryChanges(before, after);
  assert.equal(changes.length, 3);
  assert.deepEqual(changes[0], { field: 'isActive', before: false, after: true });
  assert.deepEqual(changes[2], { field: 'invoiceNumber', category: 'WATER', before: null, after: 'INV-42' });
  assert.ok(!JSON.stringify(changes).includes('private'));
  const row = presentAudit({ entityName: 'PAYMENT_SUBMISSION', entityId: 174, oldValues: before, newValues: after });
  assert.equal(row.context.changeCount, 3); assert.equal(row.oldValues, undefined); assert.equal(row.newValues, undefined);
  assert.deepEqual(auditSummaryChanges({ invoices: [{ chargeType: 'WATER' }] }, { invoices: [{ chargeType: 'WATER', invoiceNumber: 'INV-42' }] }), [], 'Missing historical invoice values must not be described as unset');
  assert.deepEqual(auditSummaryChanges({ invoices: [{ chargeType: 'WATER', invoiceNumber: null }] }, { invoices: [{ chargeType: 'WATER', invoiceNumber: { password: 'private' } }] }), [], 'Nested invoice objects must not enter scalar summaries');
});
test('automatic changes do not create user activity while delivery states still persist', async () => {
  const calls = [];
  const client = { query: async (sql, values) => { calls.push({ sql, values }); return { rows: sql.startsWith('UPDATE') ? [{ id: 1 }] : [] }; } };
  assert.equal(await writeAuditLog({ client, entityName: 'ANALYTICS', action: 'REFRESH_FORECASTS' }), false);
  assert.equal(await writeAuditLog({ client, actorUserId: 1, entityName: 'UNIT', action: 'UPDATE', context: { origin: 'SYSTEM' } }), false);
  assert.equal(calls.length, 0);
  const result = await saveDeliveryOutcomes(client, [{ delivery: { id: 1, unitNumber: '232', billId: 42 }, error: null }, { delivery: { id: 2, unitNumber: '233', billId: 43 }, error: new Error('private SMTP credentials') }]);
  assert.deepEqual(result, { sent: 1, failed: 1 }); assert.equal(calls.at(-1).sql, 'COMMIT');
  assert.equal(calls.filter(row => row.sql.includes('INSERT INTO audit_logs')).length, 0);
  assert.ok(!JSON.stringify(calls).includes('private SMTP credentials'));
});

test('publication summaries include a bounded safe preview from saved SOAs and accurate affected counts', () => {
  const record = { entityName: 'UNIT_BILL', entityId: 100, fullName: 'Tanjiro Kamado', unitNumber: '307', periodStart: '2026-10-05', periodEnd: '2026-11-05', email: 'private@example.invalid', before: { publishedAt: null }, after: { publishedAt: '2026-10-27', charges: [{ amount: 123 }] } };
  const log = { entityName: 'BILLING_PERIOD', action: 'PUBLISHED', context: { affectedRecords: [record], counts: { queuedEmails: 0 } }, newValues: { billIds: [100], mode: 'SELECTED' } };
  const summary = presentAudit(log);
  assert.equal(summary.context.affectedTargets[0].fullName, 'Tanjiro Kamado');
  assert.equal(summary.context.affectedTargets[0].unitNumber, '307');
  assert.equal(summary.context.counts.publishedCount, 1);
  assert.equal(summary.context.affectedRecords, undefined);
  assert.doesNotMatch(JSON.stringify(summary), /private@example|charges|publishedAt/);
  assert.deepEqual(presentAudit(log, { detail: true }).context.affectedRecords, [record]);
  const batch = presentAudit({ ...log, context: { affectedRecords: Array.from({ length: 10 }, (_, id) => ({ ...record, entityId: id })) } });
  assert.equal(batch.context.affectedCount, 10); assert.equal(batch.context.affectedTargets.length, 3);
  const legacy = presentAudit({ entityName: 'BILLING_PERIOD', action: 'PUBLISHED', newValues: { billIds: [1, 2] } });
  assert.equal(legacy.context.counts.publishedCount, 2); assert.deepEqual(legacy.context.affectedTargets, []);
});
