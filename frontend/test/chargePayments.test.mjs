import assert from 'node:assert/strict'
import test from 'node:test'
import { chargeDetails, isWaterOnly, payableBalance, payablePaid, currency } from '../src/utils/chargePayments.js'

test('tenant cards show water payable figures without changing overall balance',()=>{
  const bill={allowedPaymentPurposes:['WATER'],remainingBalance:1608.84,approvedAmount:58.9,payableBalance:0,payableApprovedAmount:58.9}
  assert.equal(isWaterOnly(bill),true); assert.equal(payableBalance(bill),0); assert.equal(payablePaid(bill),58.9); assert.equal(bill.remainingBalance,1608.84)
})
test('owner cards retain overall totals and peso grouping',()=>{
  const bill={allowedPaymentPurposes:['WATER','ASSOCIATION_DUES','COMBINED'],remainingBalance:1667.74,approvedAmount:0}
  assert.equal(isWaterOnly(bill),false); assert.equal(payableBalance(bill),1667.74); assert.equal(currency(1608.84),'₱1,608.84')
})
test('template fallback puts penalty only on association and never treats a bank reference as an invoice',()=>{
  const bill={latePenaltyAmount:80,invoiceNumber:'BANK-123',charges:[{chargeType:'WATER',amount:58.9},{chargeType:'ASSOCIATION_DUES',amount:1608.84}]}
  assert.equal(chargeDetails(bill,'WATER').penaltyAmount,0); assert.equal(chargeDetails(bill,'ASSOCIATION_DUES').billedAmount,1688.84)
  assert.deepEqual(chargeDetails(bill,'WATER').invoiceReferences,[])
})
