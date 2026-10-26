import assert from 'node:assert/strict';
import test from 'node:test';
import { auditTarget, changedAuditRecords, presentAudit, sameAuditValues, sanitizeAudit } from '../services/auditDetails.js';
import { writeAuditLog } from '../services/auditLog.js';
import { saveDeliveryOutcomes } from '../services/auditDelivery.js';

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
