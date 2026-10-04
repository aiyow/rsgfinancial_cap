import assert from 'node:assert/strict'
import test from 'node:test'
import { paymentAmountSummary, paymentDateTime, paymentInvoiceReferences, paymentMethodLabel } from '../src/utils/paymentHistory.js'

test('approved history uses the verified amount with peso grouping, including genuine zero', () => {
  assert.deepEqual(paymentAmountSummary({reviewStatus:'APPROVED',verifiedAmount:'2030',ocrAmount:100}),{label:'Verified amount',value:'₱2,030.00'})
  assert.equal(paymentAmountSummary({reviewStatus:'APPROVED',verifiedAmount:0}).value,'₱0.00')
})
test('pending and rejected detected amounts are explicitly unverified', () => {
  for (const reviewStatus of ['PENDING','REJECTED']) assert.deepEqual(paymentAmountSummary({reviewStatus,ocrAmount:58.9}),{label:'Detected · unverified',value:'₱58.90'})
  assert.equal(paymentAmountSummary({reviewStatus:'PENDING'}).value,'Awaiting review')
  assert.equal(paymentAmountSummary({reviewStatus:'REJECTED'}).value,'Not verified')
  for (const ocrAmount of [null,'',Infinity,NaN,-1,false]) assert.equal(paymentAmountSummary({reviewStatus:'PENDING',ocrAmount}).value,'Awaiting review')
})
test('shared invoices appear once and transaction references are never invoices', () => {
  assert.deepEqual(paymentInvoiceReferences({verifiedReferenceNo:'BANK-123',allocations:[{invoiceNumber:'SHARED'},{invoiceNumber:'SHARED'},{invoiceNumber:null}]}),['SHARED'])
  assert.deepEqual(paymentInvoiceReferences({verifiedReferenceNo:'BANK-123'}),[])
})
test('history timestamps use Manila time and missing dates remain unavailable', () => {
  assert.match(paymentDateTime('2026-10-04T12:27:00Z'),/8:27/)
  assert.match(paymentDateTime('2026-10-04T12:27:00Z'),/PM/)
  assert.equal(paymentDateTime(null),'—')
  assert.equal(paymentDateTime('invalid'),'—')
  assert.equal(paymentMethodLabel('BANK_TRANSFER'),'Bank transfer')
})
