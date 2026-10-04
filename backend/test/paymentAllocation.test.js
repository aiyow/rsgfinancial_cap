import assert from 'node:assert/strict';
import test from 'node:test';
import { cents, allocatePaymentPurpose, allocateCategoryCredit, allowedPaymentPurposes } from '../services/paymentAllocation.js';
import { recipientPaymentDetails } from '../services/paymentRecipients.js';

test('tenant purpose is specific to the unit relationship; owner can choose all purposes',()=>{
  assert.deepEqual(allowedPaymentPurposes(['TENANT']),['WATER']);
  assert.deepEqual(allowedPaymentPurposes(['OWNER']),['WATER','ASSOCIATION_DUES','COMBINED']);
  assert.deepEqual(allowedPaymentPurposes([]),[]);
  assert.equal(allowedPaymentPurposes(['TENANT','OWNER']).length,3);
});
test('water and association designations never cross categories',()=>{
  assert.deepEqual(allocatePaymentPurpose({paymentPurpose:'WATER',amount:58.90,associationRemaining:1608.84,waterRemaining:58.90}),[{chargeType:'WATER',allocatedAmount:58.9}]);
  assert.deepEqual(allocatePaymentPurpose({paymentPurpose:'ASSOCIATION_DUES',amount:2000,associationRemaining:1608.84,waterRemaining:58.90}),[{chargeType:'ASSOCIATION_DUES',allocatedAmount:2000}]);
});
test('combined partial prioritizes association; excess remains association',()=>{
  const balances={associationRemaining:1608.84,waterRemaining:58.90,paymentPurpose:'COMBINED'};
  assert.deepEqual(allocatePaymentPurpose({...balances,amount:1000}),[{chargeType:'ASSOCIATION_DUES',allocatedAmount:1000}]);
  assert.deepEqual(allocatePaymentPurpose({...balances,amount:1800}),[{chargeType:'ASSOCIATION_DUES',allocatedAmount:1741.1},{chargeType:'WATER',allocatedAmount:58.9}]);
});
test('all centavo splits reconcile exactly including zero charges',()=>{
  for(let amount=1;amount<10000;amount+=17) {
    const rows=allocatePaymentPurpose({paymentPurpose:'COMBINED',amount:amount/100,associationRemaining:23.07,waterRemaining:5.13});
    assert.equal(rows.reduce((sum,row)=>sum+cents(row.allocatedAmount),0),amount);
  }
  assert.deepEqual(allocatePaymentPurpose({paymentPurpose:'COMBINED',amount:1}),[{chargeType:'ASSOCIATION_DUES',allocatedAmount:1}]);
});
test('invalid monetary values and purposes are rejected, not converted to zero',()=>{
  for(const value of [null,undefined,'',' ',NaN,Infinity,-1,0.001,true]) assert.throws(()=>cents(value));
  assert.throws(()=>allocatePaymentPurpose({paymentPurpose:'WATER',amount:0}));
  assert.throws(()=>allocatePaymentPurpose({paymentPurpose:'UNKNOWN',amount:1}));
});
test('category applications cap principal and penalty without compounding',()=>{
  assert.deepEqual(allocateCategoryCredit({principalRemaining:100,penaltyRemaining:10,availableAmount:105}),{principal:100,penalty:5,advance:0});
  assert.deepEqual(allocateCategoryCredit({principalRemaining:0,penaltyRemaining:0,availableAmount:50}),{principal:0,penalty:0,advance:50});
});
test('tenant reminders stop at water settlement and do not include owner penalties',()=>{
  const chargePayments={WATER:{remainingBalance:0},ASSOCIATION_DUES:{remainingBalance:1608.84,penaltyAmount:80}};
  assert.equal(recipientPaymentDetails({relationshipType:'TENANT',chargePayments}).remainingBalance,0);
  assert.equal(recipientPaymentDetails({relationshipType:'TENANT',chargePayments}).latePenaltyAmount,0);
  assert.equal(recipientPaymentDetails({relationshipType:'OWNER',chargePayments}).remainingBalance,1608.84);
});
