import assert from 'node:assert/strict'
import test from 'node:test'
import { auditChanges, auditChangeSummary, auditSummary, auditTime, auditValue } from '../src/utils/auditLogPresentation.js'
test('deleted batch summaries identify the batch and saved coverage', () => {
  const text = auditSummary({ entityName: 'BILLING_PERIOD', entityId: 42, action: 'DELETED', context: { target: { periodStart: '2026-10-05', periodEnd: '2026-11-05' } } })
  assert.match(text, /Deleted Billing batch/); assert.match(text, /Oct/); assert.match(text, /Nov/)
  assert.ok(!text.includes('#42'))
})

test('payment summaries identify resident, unit, reference, amount and coverage', () => {
  const log = { entityName: 'PAYMENT_SUBMISSION', entityId: 174, action: 'EDIT_INVOICES', context: { target: { fullName: 'Juan Dela Cruz', unitNumber: '232', paymentReference: 'REF-0000174', amount: 1500, paymentPurpose: 'COMBINED', paymentMethod: 'GCASH', periodStart: '2026-10-05', periodEnd: '2026-11-05' }, changes: [{ field: 'invoiceNumber', category: 'ASSOCIATION_DUES', before: '2312', after: '#2312' }] } }
  const text = auditSummary(log)
  assert.match(text, /Updated invoices for Juan Dela Cruz/)
  assert.match(text, /Unit 232.*REF-0000174.*₱1,500.00.*Water \+ association dues.*GCash/)
  assert.match(text, /Oct.*Nov/)
  assert.ok(!text.includes('#174'))
  assert.equal(auditChangeSummary(log), 'Association dues invoice: 2312 → #2312')
})

test('pending detected amounts remain unverified and missing identity is explicit', () => {
  const text = auditSummary({ entityName: 'PAYMENT_SUBMISSION', entityId: 174, action: 'SUBMIT', context: { target: { fullName: 'Juan Dela Cruz', unitNumber: '232', detectedAmount: 1500 } } })
  assert.match(text, /detected \(unverified\)/)
  assert.ok(!text.includes('REF-'))
  assert.match(auditSummary({ entityName: 'PAYMENT_SUBMISSION', entityId: 174, action: 'DELETE' }), /Identifying details not recorded/)
  assert.equal(auditSummary({ entityName: 'UNIT', entityId: 10, action: 'UPDATE', context: { target: { unitNumber: '232' } } }), 'Updated Unit 232')
})

test('compact changes preserve zero, false, unset invoices and affected counts', () => {
  const text = auditChangeSummary({ context: { changes: [{ field: 'waterRatePerCubicM', before: 0, after: 23 }, { field: 'isActive', before: false, after: true }, { field: 'invoiceNumber', category: 'WATER', before: null, after: 'INV-42' }], changeCount: 4, counts: { billCount: 143 } } })
  assert.match(text, /₱0.00 → ₱23.00/); assert.match(text, /No → Yes/); assert.match(text, /Water invoice: Not set → INV-42/); assert.match(text, /1 more field changed/); assert.match(text, /143 SOAs/)
})
test('changes format dates and money, preserve zero/false, and never render credentials', () => {
  const rows = auditChanges({ waterRatePerCubicM: 0, isActive: false, password: 'private', updatedAt: 'old' }, { waterRatePerCubicM: 23, isActive: true, password: 'new', updatedAt: 'new' })
  assert.equal(rows.length, 2); assert.match(rows[0].before, /0.00/); assert.equal(rows[1].before, 'No'); assert.equal(rows[1].after, 'Yes')
  assert.equal(auditValue(undefined), 'Not recorded'); assert.equal(auditValue(null), 'None')
  assert.ok(!JSON.stringify(rows).includes('private'))
})
test('times explicitly use Manila rather than host timezone', () => {
  assert.match(auditTime('2026-10-25T16:01:00Z'), /26/)
  assert.match(auditTime('2026-10-25T16:01:00Z'), /12:01:00|00:01:00/)
})
