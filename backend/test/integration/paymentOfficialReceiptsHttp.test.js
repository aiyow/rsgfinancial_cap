import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import express from 'express';
import jwt from 'jsonwebtoken';
import pool from '../../config/db.js';
import paymentRoutes from '../../routes/paymentRoutes.js';
import errorHandler from '../../middleware/errorHandler.js';
import { createPaymentAllocations } from "../../services/payments.js";

test('one unique REF per approved transaction across uploads, manual payments and existing records',async t=>{
 const schema='codex_payment_or_'+randomUUID().replaceAll('-','');assert.match(schema,/^codex_payment_or_[a-f0-9]{32}$/);
 const url=process.env.DATABASE_URL?new URL(process.env.DATABASE_URL):null;if(url)url.hostname=url.hostname.replace('-pooler.','.');
 const fixtures=new pg.Pool({...url?{connectionString:url.toString(),ssl:pool.options.ssl}:pool.options,options:`-c search_path=${schema}`,connectionTimeoutMillis:10000,max:8});
 const setup=await fixtures.connect();const original={query:pool.query,connect:pool.connect,secret:process.env.JWT_SECRET};
 let server,created=false,failAudit=false;
 try{
  await setup.query(`CREATE SCHEMA "${schema}"`);created=true;
  assert.equal((await setup.query('SELECT current_schema() AS schema')).rows[0].schema,schema);
  const tables=['users','units','unit_assignments','billing_periods','unit_bills','bill_charges','payment_submissions','payment_charge_allocations','payment_applications','payment_ledger_policy','audit_logs','user_notifications','billing_forecasts','prescriptive_recommendations'];
  for(const table of tables){
   await setup.query(`CREATE TABLE ${table}(LIKE public.${table} INCLUDING DEFAULTS INCLUDING IDENTITY INCLUDING GENERATED)`);
   const columns=(await setup.query('SELECT column_name,is_identity FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',[schema,table])).rows;
   for(const column of columns)if(column.column_name!=='id')await setup.query(`ALTER TABLE ${table} ALTER COLUMN "${column.column_name}" DROP NOT NULL`);
   await setup.query(`ALTER TABLE ${table} ADD PRIMARY KEY(id)`);
   if(columns.find(c=>c.column_name==='id').is_identity!=='YES'){
    await setup.query(`CREATE SEQUENCE fixture_${table}_ids START 1000`);
    await setup.query(`ALTER TABLE ${table} ALTER COLUMN id SET DEFAULT nextval('fixture_${table}_ids')`);
   }
  }
  // Exercise migration on an old-shaped table with existing records, not just new inserts.
  await setup.query('ALTER TABLE payment_submissions DROP COLUMN IF EXISTS official_receipt_no');
  await setup.query(`CREATE UNIQUE INDEX fixture_allocation_unique ON payment_charge_allocations(payment_submission_id,charge_type);
    CREATE UNIQUE INDEX fixture_notifications_unique ON user_notifications(recipient_user_id,dedupe_key);
    INSERT INTO users(id,full_name,email,password_hash,role,is_active,approval_status,auth_version) VALUES
     (1,'OR Admin','admin@example.invalid','fixture','ADMIN',TRUE,'APPROVED',0),
     (2,'OR Resident','resident@example.invalid','fixture','RESIDENT',TRUE,'APPROVED',0),
     (3,'OR Associate','associate@example.invalid','fixture','COLLECTOR',TRUE,'APPROVED',0);
    INSERT INTO units(id,unit_number,occupancy_status) VALUES(10,'Test 231','OCCUPIED'),(20,'Test 232','VACANT');
    INSERT INTO unit_assignments(id,unit_id,user_id,relationship_type,start_date,is_primary_payer) VALUES(1,10,2,'OWNER','2020-01-01',TRUE);
    INSERT INTO billing_periods(id,period_start,period_end,status,period_type) VALUES(1,'2026-01-01','2026-02-01','DRAFT','LIVE_BILLING');
    INSERT INTO unit_bills(id,unit_id,billing_period_id,unit_number_snapshot,payer_name_snapshot,period_start_snapshot,period_end_snapshot,due_date_snapshot,published_at,late_penalty_amount,late_penalty_percent_snapshot)
     VALUES(100,10,1,'Test 231','OR Resident','2026-01-01','2026-02-01','2099-01-01',NOW(),0,0);
    INSERT INTO bill_charges(unit_bill_id,charge_type,quantity,rate_applied) VALUES(100,'WATER',1,10),(100,'ASSOCIATION_DUES',1,20);
    INSERT INTO payment_ledger_policy(id,version) VALUES(1,2);
    INSERT INTO payment_submissions(id,unit_id,submitted_by,entry_type,payment_method,payment_purpose,review_status,reviewed_by,reviewed_at,verified_amount,verified_reference_no,verified_payment_date)
     VALUES(101,10,1,'MANUAL','CASH','WATER','APPROVED',1,NOW(),1,'HISTORICAL-OR-FIXTURE','2026-01-01');`);
  await createPaymentAllocations(setup,101);
  for(const id of [200,201,303])await setup.query(`INSERT INTO payment_submissions(id,unit_id,submitted_by,target_unit_bill_id,entry_type,payment_method,payment_purpose,review_status,receipt_original_name,receipt_mime_type,receipt_path)
   VALUES($1,10,2,100,'RECEIPT_UPLOAD','GCASH','COMBINED','PENDING','fixture.jpg','image/jpeg','fixture-unused')`,[id]);
  await setup.query("UPDATE payment_submissions SET ocr_reference_no='IMAGE-REF-200' WHERE id=200");
  const before=(await setup.query("SELECT jsonb_agg(to_jsonb(p)-'official_receipt_no' ORDER BY p.id) AS rows FROM payment_submissions p")).rows[0].rows;
  await setup.query((await readFile(new URL('../../database/migrations/040_payment_official_receipts.sql',import.meta.url),'utf8')).replaceAll('public.',''));
  assert.equal((await setup.query('SELECT official_receipt_no FROM payment_submissions WHERE id=101')).rows[0].official_receipt_no,'OR-0000000101');
  const migration=await readFile(new URL('../../database/migrations/041_payment_reference_format.sql',import.meta.url),'utf8');
  await setup.query(migration.replaceAll('public.',''));
  await setup.query(migration.replaceAll('public.','')); // Repeat-safe conversion.
  const after=(await setup.query("SELECT jsonb_agg(to_jsonb(p)-'official_receipt_no' ORDER BY p.id) AS rows FROM payment_submissions p")).rows[0].rows;assert.deepEqual(after,before);
  async function scoped(){const c=await fixtures.connect();assert.equal((await c.query('SELECT current_schema() AS schema')).rows[0].schema,schema);return c;}
  pool.query=async(sql,values)=>{const c=await scoped();try{return await c.query(sql,values);}finally{c.release();}};
  pool.connect=async()=>{const c=await scoped();return{query(sql,values){if(failAudit&&sql.includes('INSERT INTO audit_logs'))throw Object.assign(new Error('Simulated audit failure'),{status:503});return c.query(sql,values);},release(){c.release();}};};
  process.env.JWT_SECRET='isolated-payment-or-test';const token=id=>jwt.sign({id,authVersion:0},process.env.JWT_SECRET);
  const app=express();app.use(express.json());app.use('/api/payments',paymentRoutes);app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  async function request(path='',body,actor=1,method=body?'POST':'GET'){
   const response=await fetch(`http://127.0.0.1:${server.address().port}/api/payments${path}`,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token(actor)}`},...(body?{body:JSON.stringify(body)}:{})});
   return{status:response.status,data:await response.json()};
  }
  const payment=async id=>(await request('/'+id)).data.payment;
  const approval={status:'APPROVED',verifiedAmount:30,paymentMethod:'GCASH',verifiedPaymentDate:'2026-01-01'};
  const manual={unitId:10,paymentMethod:'CASH',paymentPurpose:'WATER',amount:5,paymentDate:'2026-01-01'};
  await t.test('historical approvals receive REFs; pending proofs do not; all authorized roles can read them',async()=>{
   assert.equal((await payment(101)).officialReceiptNo,'REF-0000101');assert.equal((await payment(101)).verifiedReferenceNo,'HISTORICAL-OR-FIXTURE');assert.equal((await payment(200)).ocrReferenceNo,'IMAGE-REF-200');assert.equal((await payment(200)).officialReceiptNo,null);
   const resident=await request('/101',undefined,2);assert.equal(resident.status,200);assert.equal(resident.data.payment.officialReceiptNo,'REF-0000101');
   const collector=await request('',undefined,3);assert.equal(collector.status,200);assert.ok(collector.data.payments.every(p=>p.reviewStatus==='APPROVED'&&p.officialReceiptNo));
   assert.equal((await request('/manual',manual,2)).status,403);
  });
  await t.test('combined receipt approval issues one REF for both category allocations; repeated approval cannot issue another',async()=>{
   const approved=await request('/200/review',approval);assert.equal(approved.status,200,JSON.stringify(approved.data));assert.equal(approved.data.officialReceiptNo,'REF-0000200');
   const p=await payment(200);assert.equal(p.officialReceiptNo,'REF-0000200');assert.equal(p.allocations.length,2);assert.equal(Number(p.verifiedAmount),30);assert.equal(p.ocrReferenceNo,'IMAGE-REF-200');assert.notEqual(p.officialReceiptNo,p.verifiedReferenceNo);
   assert.equal((await request('/200/review',approval)).status,409);
   const edited=await request('/200/invoice-references',{invoices:[{chargeType:'WATER',invoiceNumber:'CATEGORY-INVOICE'}]},3,'PATCH');assert.equal(edited.status,200);assert.equal(edited.data.payment.officialReceiptNo,p.officialReceiptNo);
   const rejected=await request('/201/review',{status:'REJECTED',remarks:'Invalid test receipt'});assert.equal(rejected.status,200);assert.equal(rejected.data.officialReceiptNo,null);assert.equal((await payment(201)).officialReceiptNo,null);
  });
  await t.test('manual and concurrent payments get distinct database numbers; REF input is read-only',async()=>{
   const created=await request('/manual',manual);assert.equal(created.status,201,JSON.stringify(created.data));assert.match(created.data.officialReceiptNo,/^REF-\d{7,}$/);
   assert.equal((await payment(created.data.paymentId)).officialReceiptNo,created.data.officialReceiptNo);
   const pair=await Promise.all([request('/manual',manual),request('/manual',{...manual,unitId:20})]);assert.ok(pair.every(r=>r.status===201));assert.notEqual(pair[0].data.officialReceiptNo,pair[1].data.officialReceiptNo);
   assert.equal((await request('/'+pair[1].data.paymentId,undefined,2)).status,404);
   assert.equal((await request('/manual',{...manual,officialReceiptNo:'REF-CUSTOM'})).status,400);
   await assert.rejects(setup.query("UPDATE payment_submissions SET official_receipt_no='REF-CUSTOM' WHERE id=101"),error=>error.code==='428C9');
   const refs=(await setup.query('SELECT official_receipt_no FROM payment_submissions WHERE official_receipt_no IS NOT NULL')).rows.map(p=>p.official_receipt_no);assert.equal(new Set(refs).size,refs.length);
  });
  await t.test('failed approval rolls back its REF and ledger changes; retry uses the transaction number once',async()=>{
   failAudit=true;const failed=await request('/303/review',approval);assert.equal(failed.status,503);failAudit=false;
   const pending=await payment(303);assert.equal(pending.reviewStatus,'PENDING');assert.equal(pending.officialReceiptNo,null);assert.equal(pending.allocations.length,0);
   const approved=await request('/303/review',approval);assert.equal(approved.status,200);assert.equal(approved.data.officialReceiptNo,'REF-0000303');
  });
  await t.test('large IDs are not truncated and uniqueness is enforced by an index',async()=>{
   await setup.query(`INSERT INTO payment_submissions(id,unit_id,entry_type,payment_purpose,review_status,verified_amount,verified_reference_no)
    VALUES(10000000001,20,'MANUAL','WATER','APPROVED',1,'LARGE-ID')`);
   assert.equal((await setup.query('SELECT official_receipt_no FROM payment_submissions WHERE id=10000000001')).rows[0].official_receipt_no,'REF-10000000001');
   assert.equal((await setup.query("SELECT COUNT(*)::int AS n FROM pg_indexes WHERE schemaname=$1 AND indexname='payment_submissions_official_receipt_unique' AND indexdef LIKE 'CREATE UNIQUE INDEX%'",[schema])).rows[0].n,1);
  });
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));pool.query=original.query;pool.connect=original.connect;
  if(original.secret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=original.secret;
  if(created&&/^codex_payment_or_[a-f0-9]{32}$/.test(schema))await setup.query(`DROP SCHEMA "${schema}" CASCADE`);
  setup.release();await fixtures.end();await pool.end();
 }
});
