import assert from 'node:assert/strict'
import test from 'node:test'
import { filterPaymentQueue, paginatePaymentQueue, paymentQueueAmount, paymentReceivedDay } from '../src/utils/paymentQueue.js'

const payments = [
  { id: 1, submittedByName: 'Juan B Dela Cruz', unitNumber: '232', reviewStatus: 'APPROVED', paymentPurpose: 'ASSOCIATION_DUES', entryType: 'RECEIPT_UPLOAD', paymentMethod: 'GCASH', submittedAt: '2026-10-04T12:27:00Z', verifiedAmount: '1620.00', ocrAmount: 1, verifiedReferenceNo: '804580839866', allocations: [{ invoiceNumber: '#2414' }] },
  { id: 2, submittedByName: 'Anna Dela Cruz', unitNumber: '231', reviewStatus: 'PENDING', paymentPurpose: 'COMBINED', entryType: 'RECEIPT_UPLOAD', paymentMethod: 'GCASH', submittedAt: '2026-10-03T16:30:00Z', ocrAmount: '2030.00', ocrReferenceNo: '6044857861787' },
  { id: 3, submittedByName: 'Precious Mae Parreño', unitNumber: '209', reviewStatus: 'APPROVED', paymentPurpose: 'WATER', entryType: 'MANUAL', paymentMethod: 'CASH', submittedAt: '2026-10-03T03:00:00Z', verifiedAmount: 58.9, allocations: [{ invoiceNumber: 'W-4212' }] },
  { id: 4, submittedByName: 'Other Resident', unitNumber: '99', reviewStatus: 'REJECTED', paymentPurpose: 'WATER', entryType: 'RECEIPT_UPLOAD', paymentMethod: 'BANK_TRANSFER', submittedAt: '2026-10-01T03:00:00Z', ocrAmount: null },
]
const ids = rows => rows.map(row => row.id)

test('search finds residents, units, accents, transaction references and issued invoices', () => {
  assert.deepEqual(ids(filterPaymentQueue(payments, { search: 'JUAN unit 232' })), [1])
  assert.deepEqual(ids(filterPaymentQueue(payments, { search: 'parreno' })), [3])
  assert.deepEqual(ids(filterPaymentQueue(payments, { search: '804580839866' })), [1])
  assert.deepEqual(ids(filterPaymentQueue(payments, { search: '6044857861787' })), [2])
  assert.deepEqual(ids(filterPaymentQueue(payments, { search: '#2414' })), [1])
  assert.deepEqual(ids(filterPaymentQueue(payments, { search: 'W-4212' })), [3])
  assert.equal(filterPaymentQueue(payments, { search: 'unmatched' }).length, 0)
})

test('status, purpose, method and source filters combine without modifying input', () => {
  assert.deepEqual(ids(filterPaymentQueue(payments, { status: 'APPROVED', purpose: 'WATER', method: 'CASH', source: 'MANUAL' })), [3])
  assert.deepEqual(ids(filterPaymentQueue(payments, { status: 'PENDING', search: 'Anna' })), [2])
  assert.deepEqual(ids(payments), [1, 2, 3, 4])
})

test('received date range is inclusive and uses Manila rather than UTC dates', () => {
  assert.equal(paymentReceivedDay(payments[1].submittedAt), '2026-10-04')
  assert.deepEqual(ids(filterPaymentQueue(payments, { dateFrom: '2026-10-04', dateTo: '2026-10-04' })), [1, 2])
  assert.equal(filterPaymentQueue(payments, { dateFrom: '2026-10-05', dateTo: '2026-10-01' }).length, 0)
  assert.equal(paymentReceivedDay('invalid'), '')
  assert.equal(paymentReceivedDay(null), '')
})

test('sorting supports recent, oldest, pending first, natural unit order and amounts', () => {
  assert.deepEqual(ids(filterPaymentQueue(payments)), [1, 2, 3, 4])
  assert.deepEqual(ids(filterPaymentQueue(payments, { sort: 'OLDEST' })), [4, 3, 2, 1])
  assert.deepEqual(ids(filterPaymentQueue(payments, { sort: 'PENDING_FIRST' })), [2, 1, 3, 4])
  assert.deepEqual(ids(filterPaymentQueue(payments, { sort: 'UNIT' })), [4, 3, 2, 1])
  assert.deepEqual(ids(filterPaymentQueue(payments, { sort: 'RESIDENT' })), [2, 1, 4, 3])
  assert.deepEqual(ids(filterPaymentQueue(payments, { sort: 'AMOUNT_HIGH' })), [2, 1, 3, 4])
  assert.deepEqual(ids(filterPaymentQueue(payments, { sort: 'AMOUNT_LOW' })), [3, 1, 2, 4])
})

test('verified and OCR amounts keep zero and never treat missing values as zero', () => {
  assert.equal(paymentQueueAmount(payments[0]), 1620)
  assert.equal(paymentQueueAmount({ reviewStatus: 'PENDING', ocrAmount: 0 }), 0)
  for (const value of [null, '', ' ', Infinity, NaN, -1, false]) assert.equal(paymentQueueAmount({ reviewStatus: 'PENDING', ocrAmount: value }), null)
})

test('pagination is bounded and filtered results never produce an empty out-of-range page', () => {
  const rows = Array.from({ length: 26 }, (_, id) => ({ id }))
  const second = paginatePaymentQueue(rows, 2, 10)
  assert.deepEqual(second.rows.map(row => row.id), [10,11,12,13,14,15,16,17,18,19])
  assert.equal(second.first, 11); assert.equal(second.last, 20); assert.equal(second.pageCount, 3)
  assert.equal(paginatePaymentQueue(rows, 99, 25).page, 2)
  assert.equal(paginatePaymentQueue(rows.slice(0, 2), 3, 10).page, 1)
  assert.equal(paginatePaymentQueue([], 3).first, 0)
  assert.equal(paginatePaymentQueue([], 3).last, 0)
})
