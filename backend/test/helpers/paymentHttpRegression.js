import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import pool from '../../config/db.js';
import paymentRoutes from '../../routes/paymentRoutes.js';
import billRoutes from '../../routes/billRoutes.js';
import errorHandler from '../../middleware/errorHandler.js';
import { validateResidentPurpose } from '../../services/paymentPermissions.js';

// Run the real Express routes inside the caller's rollback-only transaction.
// Inner BEGIN/COMMIT become savepoints; the outer transaction is never committed.
export async function runPaymentHttpRegression(client,{billId,unitId,adminId,residentId}) {
  const originalQuery=pool.query, originalConnect=pool.connect;
  const baseQuery=client.query.bind(client), nested=[];
  let sequence=0,failNotification=false;
  async function query(sql,values) {
    if(sql==='BEGIN') { const name=`api_${++sequence}`; nested.push(name); return baseQuery(`SAVEPOINT ${name}`); }
    if(sql==='COMMIT') return baseQuery(`RELEASE SAVEPOINT ${nested.pop()}`);
    if(sql==='ROLLBACK' && nested.length) { const name=nested.pop(); await baseQuery(`ROLLBACK TO SAVEPOINT ${name}`); return baseQuery(`RELEASE SAVEPOINT ${name}`); }
    if(failNotification && /INSERT INTO user_notifications/i.test(sql)) throw new Error('Expected rollback test: notification insertion failed.');
    return baseQuery(sql,values);
  }
  pool.query=query; pool.connect=async()=>({query,release(){}});
  const app=express(); app.use(express.json()); app.use('/api/payments',paymentRoutes); app.use('/api/bills',billRoutes); app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  async function token(id) {
    const user=(await baseQuery('SELECT auth_version FROM users WHERE id=$1',[id])).rows[0];
    return jwt.sign({id,authVersion:user.auth_version},process.env.JWT_SECRET,{expiresIn:'5m'});
  }
  const admin=await token(adminId);
  async function request(path,method='GET',body,auth=admin) {
    const response=await fetch(url+path,{method,headers:{Authorization:`Bearer ${auth}`,...(body ? {'Content-Type':'application/json'} : {})},...(body ? {body:JSON.stringify(body)} : {})});
    return {status:response.status,data:await response.json()};
  }
  try {
    const preview=await request('/api/payments/allocation-preview','POST',{targetBillId:Number(billId),paymentPurpose:'WATER',amount:58.9,paymentDate:'2026-10-01'});
    assert.equal(preview.status,200,JSON.stringify(preview.data)); assert.equal(preview.data.allocations[0].chargeType,'WATER');
    const invalid=await request('/api/payments/allocation-preview','POST',{targetBillId:Number(billId),paymentPurpose:'INVALID',amount:1,paymentDate:'2026-10-01'});
    assert.equal(invalid.status,400);
    const manual=await request('/api/payments/manual','POST',{targetBillId:Number(billId),paymentPurpose:'WATER',paymentMethod:'CASH',amount:58.9,paymentDate:'2026-10-01'});
    assert.equal(manual.status,201,JSON.stringify(manual.data));
    const id=manual.data.paymentId;
    let detail=await request(`/api/payments/${id}`); assert.equal(detail.status,200); assert.equal(detail.data.payment.paymentPurpose,'WATER');
    assert.equal(detail.data.payment.allocations.length,1);
    const invoices=await request(`/api/payments/${id}/invoice-references`,'PATCH',{invoices:[{chargeType:'WATER',invoiceNumber:'HTTP-WATER'}]});
    assert.equal(invoices.status,200,JSON.stringify(invoices.data)); assert.equal(invoices.data.payment.allocations[0].invoiceNumber,'HTTP-WATER');
    const cross=await request(`/api/payments/${id}/invoice-references`,'PATCH',{invoices:[{chargeType:'ASSOCIATION_DUES',invoiceNumber:'WRONG'}]}); assert.equal(cross.status,400);
    const legacy=await request(`/api/bills/${billId}/payment-references`,'PATCH',{invoiceNumber:'AMBIGUOUS'}); assert.equal(legacy.status,400);
    // Flush deferred ledger checks before the legacy template schema's idempotent ALTER.
    await baseQuery('SET CONSTRAINTS ALL IMMEDIATE');
    await baseQuery('SET CONSTRAINTS ALL DEFERRED');
    const soa=await request(`/api/bills/${billId}`); assert.equal(soa.status,200,JSON.stringify(soa.data));
    assert.equal(soa.data.bill.paymentStatus,'PARTIAL'); assert.equal(soa.data.bill.chargePayments.WATER.remainingBalance,0);
    assert.deepEqual(soa.data.bill.chargePayments.ASSOCIATION_DUES.invoiceReferences,[]);
    const credits=await request('/api/payments/credits'); assert.equal(credits.status,200); assert.ok('waterAdvance' in credits.data.credits.find(row=>String(row.unitId)===String(unitId)));
    const repeated=await request(`/api/payments/${id}/review`,'POST',{status:'APPROVED',verifiedAmount:58.9,paymentMethod:'CASH',verifiedPaymentDate:'2026-10-01'}); assert.equal(repeated.status,409);
    if(residentId) {
      const resident=await token(residentId);
      const assignment=(await baseQuery('SELECT id FROM unit_assignments WHERE unit_id=$1 AND user_id=$2 AND end_date IS NULL',[unitId,residentId])).rows[0];
      if(assignment) await baseQuery("UPDATE unit_assignments SET relationship_type='TENANT',start_date=CURRENT_DATE WHERE id=$1",[assignment.id]);
      else await baseQuery("INSERT INTO unit_assignments(unit_id,user_id,relationship_type,start_date) VALUES($1,$2,'TENANT',CURRENT_DATE)",[unitId,residentId]);
      await baseQuery('UPDATE unit_bills SET published_at=COALESCE(published_at,NOW()) WHERE id=$1',[billId]);
      await baseQuery('SET CONSTRAINTS ALL IMMEDIATE'); await baseQuery('SET CONSTRAINTS ALL DEFERRED');
      const tenantSoa=await request(`/api/bills/${billId}`,'GET',undefined,resident);
      assert.equal(tenantSoa.status,200,JSON.stringify(tenantSoa.data));
      assert.deepEqual(tenantSoa.data.bill.allowedPaymentPurposes,['WATER']); assert.equal(tenantSoa.data.bill.payableBalance,0);
      await assert.rejects(validateResidentPurpose({query:baseQuery},{unitId,chargePayments:tenantSoa.data.bill.chargePayments},residentId,'WATER'),error=>error.status===409);
      await assert.rejects(validateResidentPurpose({query:baseQuery},{unitId,chargePayments:tenantSoa.data.bill.chargePayments},residentId,'ASSOCIATION_DUES'),error=>error.status===403);
      await baseQuery("UPDATE unit_assignments SET relationship_type='OWNER' WHERE unit_id=$1 AND user_id=$2 AND end_date IS NULL",[unitId,residentId]);
      const ownerSoa=await request(`/api/bills/${billId}`,'GET',undefined,resident);
      assert.equal(ownerSoa.status,200); assert.equal(ownerSoa.data.bill.allowedPaymentPurposes.length,3); assert.equal(ownerSoa.data.bill.payableBalance,1608.84);
      const forbidden=await request('/api/payments/manual','POST',{targetBillId:Number(billId),paymentPurpose:'WATER',paymentMethod:'CASH',amount:1,paymentDate:'2026-10-01'},resident); assert.equal(forbidden.status,403);
      const pending=(await baseQuery(`INSERT INTO payment_submissions(unit_id,submitted_by,target_unit_bill_id,entry_type,receipt_path,receipt_original_name,
        receipt_mime_type,receipt_sha256,ocr_quality_status,payment_purpose) VALUES($1,$2,$3,'RECEIPT_UPLOAD','test-only','test.png','image/png',encode(sha256(random()::text::bytea),'hex'),'GOOD','ASSOCIATION_DUES') RETURNING id`,[unitId,residentId,billId])).rows[0].id;
      const initial=(await baseQuery('SELECT COUNT(*)::int AS count FROM audit_logs')).rows[0].count;
      failNotification=true;
      const failure=await request(`/api/payments/${pending}/review`,'POST',{status:'APPROVED',verifiedAmount:100,paymentMethod:'CASH',verifiedPaymentDate:'2026-10-01'});
      failNotification=false; assert.equal(failure.status,500);
      assert.equal((await baseQuery('SELECT review_status FROM payment_submissions WHERE id=$1',[pending])).rows[0].review_status,'PENDING');
      assert.equal((await baseQuery('SELECT COUNT(*)::int AS count FROM payment_charge_allocations WHERE payment_submission_id=$1',[pending])).rows[0].count,0);
      assert.equal((await baseQuery('SELECT COUNT(*)::int AS count FROM audit_logs')).rows[0].count,initial);
    }
    assert.equal(nested.length,0);
  } finally {
    pool.query=originalQuery; pool.connect=originalConnect;
    await new Promise(resolve=>server.close(resolve));
  }
}
