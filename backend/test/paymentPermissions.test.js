import assert from 'node:assert/strict';
import test from 'node:test';
import { validateResidentPurpose } from '../services/paymentPermissions.js';

const bill={unitId:32,total:1667.74,approved:0,chargePayments:{WATER:{remainingBalance:58.9},ASSOCIATION_DUES:{remainingBalance:1608.84}}};
function assignment(relationships,expectedUnit=32) { return { async query(sql,params) {
  assert.equal(params[0],expectedUnit); assert.match(sql,/start_date <=/); assert.match(sql,/end_date IS NULL/);
  return {rows:relationships.map(relationship_type=>({relationship_type}))};
} }; }
test('server rejects forged combined/association tenant submissions and allows water',async()=>{
  assert.equal(await validateResidentPurpose(assignment(['TENANT']),bill,7,'WATER'),58.9);
  for(const purpose of ['COMBINED','ASSOCIATION_DUES']) await assert.rejects(validateResidentPurpose(assignment(['TENANT']),bill,7,purpose),{status:403});
});
test('owner purposes remain available only for the specific assigned unit',async()=>{
  assert.equal(await validateResidentPurpose(assignment(['OWNER']),bill,7,'COMBINED'),1667.74);
  await assert.rejects(validateResidentPurpose(assignment([]),bill,7,'WATER'),{status:403});
});
test('settled water rejects another proof while overall SOA remains partly unpaid',async()=>{
  await assert.rejects(validateResidentPurpose(assignment(['TENANT']),{...bill,approved:58.9,chargePayments:{...bill.chargePayments,WATER:{remainingBalance:0}}},7,'WATER'),{status:409});
  await assert.rejects(validateResidentPurpose(assignment(['OWNER']),bill,7,undefined),{status:400});
});
