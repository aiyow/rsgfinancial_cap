import { allowedPaymentPurposes, PAYMENT_PURPOSES } from './paymentAllocation.js';

export async function validateResidentPurpose(client,bill,userId,purpose) {
  if(!bill) throw Object.assign(new Error('Published SOA not found.'),{status:404});
  if(!PAYMENT_PURPOSES.includes(purpose)) throw Object.assign(new Error('Choose a payment purpose.'),{status:400});
  const access=await client.query(`SELECT relationship_type FROM unit_assignments WHERE unit_id=$1 AND user_id=$2
    AND end_date IS NULL AND start_date <= (NOW() AT TIME ZONE 'Asia/Manila')::date`,[bill.unitId,userId]);
  if(!allowedPaymentPurposes(access.rows.map(row=>row.relationship_type)).includes(purpose)) {
    throw Object.assign(new Error('Your assignment does not permit this purpose. Tenants may pay water only.'),{status:403});
  }
  const balance=purpose==='COMBINED' ? Number(bill.total)-Number(bill.approved) : Number(bill.chargePayments[purpose].remainingBalance);
  if(!(balance>0)) throw Object.assign(new Error('The selected charge is already paid.'),{status:409});
  return balance;
}
