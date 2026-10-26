import assert from 'node:assert/strict'
import test from 'node:test'
import { auditChanges, auditSummary, auditTime, auditValue } from '../src/utils/auditLogPresentation.js'
test('deleted batch summaries identify the batch and saved coverage', () => {
  const text = auditSummary({ entityName: 'BILLING_PERIOD', entityId: 42, action: 'DELETED', context: { target: { periodStart: '2026-10-05', periodEnd: '2026-11-05' } } })
  assert.match(text, /Deleted Billing batch #42/); assert.match(text, /Oct/); assert.match(text, /Nov/)
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
