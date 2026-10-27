import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import express from 'express';
import jwt from 'jsonwebtoken';
import pool from '../../config/db.js';
import billRoutes from '../../routes/billRoutes.js';
import errorHandler from '../../middleware/errorHandler.js';
import { createPaymentAllocations } from "../../services/payments.js";

// Only this disposable namespace is writable. Empty email-delivery fixtures
// prevent the published-SOA correction workflow from sending any email.
test('SOA statement-date correction accepts advance-billed coverage and preserves safeguards',async t=>{
 const schema='codex_soa_dates_'+randomUUID().replaceAll('-','');assert.match(schema,/^codex_soa_dates_[a-f0-9]{32}$/);
 const url=process.env.DATABASE_URL?new URL(process.env.DATABASE_URL):null;if(url)url.hostname=url.hostname.replace('-pooler.','.');
 const fixtures=new pg.Pool({...url?{connectionString:url.toString(),ssl:pool.options.ssl}:pool.options,options:`-c search_path=${schema}`,max:8,connectionTimeoutMillis:10000});
 const setup=await fixtures.connect(),original={query:pool.query,connect:pool.connect,secret:process.env.JWT_SECRET};
 let created=false,server,failAudit=false;
 try {
  await setup.query(`CREATE SCHEMA "${schema}"`);created=true;assert.equal((await setup.query('SELECT current_schema() AS schema')).rows[0].schema,schema);
  const tables=['users','units','unit_assignments','billing_periods','unit_bills','bill_charges','meter_readings','payment_submissions','payment_charge_allocations','payment_applications','payment_ledger_policy','soa_templates','soa_email_deliveries','billing_error_reports','audit_logs','user_notifications','billing_forecasts','prescriptive_recommendations'];
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
  await setup.query(`CREATE UNIQUE INDEX fixture_allocations ON payment_charge_allocations(payment_submission_id,charge_type);
   CREATE UNIQUE INDEX fixture_notifications ON user_notifications(recipient_user_id,dedupe_key);
   INSERT INTO users(id,full_name,email,password_hash,role,is_active,approval_status,auth_version) VALUES
    (1,'Fixture Admin','admin@example.invalid','unused','ADMIN',TRUE,'APPROVED',0),
    (2,'Fixture Associate','associate@example.invalid','unused','COLLECTOR',TRUE,'APPROVED',0),
    (3,'Fixture Resident','resident@example.invalid','unused','RESIDENT',TRUE,'APPROVED',0);
   INSERT INTO units(id,unit_number,floor,occupancy_status) VALUES(10,'232','2','OCCUPIED');
   INSERT INTO unit_assignments(id,unit_id,user_id,relationship_type,start_date,is_primary_payer) VALUES(1,10,3,'OWNER','2020-01-01',TRUE);
   INSERT INTO billing_periods(id,period_start,period_end,due_date,status,period_type) VALUES(1,'2026-10-05','2026-11-05','2026-11-19','FORWARDED','LIVE_BILLING');
   INSERT INTO unit_bills(id,unit_id,billing_period_id,unit_number_snapshot,payer_name_snapshot,payer_email_snapshot,period_start_snapshot,period_end_snapshot,statement_date,due_date_snapshot,previous_reading_snapshot,current_reading_snapshot,published_at,published_by,soa_revision,late_penalty_percent_snapshot,late_penalty_amount)
    VALUES(100,10,1,'232','Fixture Resident','resident@example.invalid','2026-10-05','2026-11-05','2026-10-24','2026-10-19',657.092,660.804,NOW(),1,1,0,0);
   INSERT INTO bill_charges(id,unit_bill_id,charge_type,quantity,rate_applied,description) VALUES(1,100,'WATER',3.712,23,'Monthly water consumption'),(2,100,'ASSOCIATION_DUES',12,134.07,'Association dues');
   INSERT INTO meter_readings(id,unit_id,billing_period_id,previous_reading,current_reading,validation_status) VALUES(700,10,1,657.092,660.804,'VALID');
   INSERT INTO payment_ledger_policy(id,version) VALUES(1,2);
   INSERT INTO billing_error_reports(id,unit_bill_id,reported_by,category,description,status) VALUES(9,100,3,'OTHER','Fixture date correction','OPEN');`);
  async function scoped(){const c=await fixtures.connect();assert.equal((await c.query('SELECT current_schema() AS schema')).rows[0].schema,schema);return c;}
  pool.query=async(sql,values)=>{const c=await scoped();try{return await c.query(sql,values);}finally{c.release();}};
  pool.connect=async()=>{const c=await scoped();return{query(sql,values){if(failAudit&&sql.includes('INSERT INTO audit_logs'))throw Object.assign(new Error('Simulated audit failure'),{status:503});return c.query(sql,values);},release(){c.release();}};};
  process.env.JWT_SECRET='private-soa-date-correction-test';
  const app=express();app.use(express.json());app.use('/api/bills',billRoutes);app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  async function request(body,actor=1,id=100){const token=actor?jwt.sign({id:actor,authVersion:0},process.env.JWT_SECRET):null;
   const response=await fetch(`http://127.0.0.1:${server.address().port}/api/bills/${id}`,{method:body?'PATCH':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,data:await response.json()};}
  const body=date=>({statementDate:date,reason:'Correct the printed statement date.'});
  const financial=async()=>{
   const r=await setup.query(`SELECT jsonb_build_object(
    'charges',(SELECT jsonb_agg(c ORDER BY id) FROM bill_charges c),
    'readings',(SELECT jsonb_agg(m ORDER BY id) FROM meter_readings m),
    'payments',(SELECT jsonb_agg(p ORDER BY id) FROM payment_submissions p),
    'allocations',(SELECT jsonb_agg(a ORDER BY id) FROM payment_charge_allocations a),
    'applied',(SELECT COALESCE(SUM(amount_applied),0) FROM payment_applications WHERE unit_bill_id=100)) AS value`);return r.rows[0].value;
  };
  const initial=await request();assert.equal(initial.status,200,JSON.stringify(initial.data));const before=await financial();
  await t.test('Admin can change October 24 to October 14 while October 19 remains due before November 5',async()=>{
   assert.equal((await request(body('2026-10-14'),null)).status,401);assert.equal((await request(body('2026-10-14'),3)).status,403);
   const result=await request(body('2026-10-14'));assert.equal(result.status,200,JSON.stringify(result.data));
   assert.equal(result.data.bill.statementDate,'2026-10-14');assert.equal(result.data.bill.dueDate,'2026-10-19');assert.equal(result.data.bill.periodStart,'2026-10-05');assert.equal(result.data.bill.periodEnd,'2026-11-05');
   assert.equal(Number(result.data.bill.totalAmount),1694.22);assert.equal(Number(result.data.bill.soaRevision),2);assert.ok(result.data.bill.publishedAt);
   assert.deepEqual(await financial(),before);
  });
  await t.test('the complete staff edit form also saves when coverage continues after the due date',async()=>{
   const full={...body('2026-10-15'),payerName:'Fixture Resident',payerEmail:'resident@example.invalid',periodStart:'2026-10-05',periodEnd:'2026-11-05',dueDate:'2026-10-19',previousReading:657.092,currentReading:660.804,
    charges:[{id:1,description:'Monthly water consumption',rateApplied:23},{id:2,description:'Association dues',quantity:12,rateApplied:134.07}]};
   const result=await request(full,2);assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.bill.statementDate,'2026-10-15');assert.deepEqual(await financial(),before);
   const audit=(await setup.query('SELECT old_values,new_values FROM audit_logs ORDER BY id DESC LIMIT 1')).rows[0];assert.equal(audit.old_values.statementDate,'2026-10-14');assert.equal(audit.new_values.statementDate,'2026-10-15');
  });
  await t.test('invalid calendar dates and reversed coverage still fail without changing the SOA',async()=>{
   const revision=(await request()).data.bill.soaRevision;
   for(const field of ['statementDate','dueDate','periodStart','periodEnd'])for(const invalid of ['2026-02-30','2026-13-01','0000-01-01']){
    const result=await request({reason:'Invalid fixture date.',[field]:invalid});assert.equal(result.status,400,JSON.stringify(result.data));assert.ok(result.data.errors.some(e=>e.field===field));
   }
   const reversed=await request({reason:'Reversed coverage fixture.',periodEnd:'2026-10-04'});assert.equal(reversed.status,400);assert.match(reversed.data.message,/Period end/);
   assert.equal((await request()).data.bill.soaRevision,revision);assert.deepEqual(await financial(),before);
   assert.equal((await request(body('2024-02-29'))).status,200);assert.equal((await request(body('2025-02-29'))).status,400);
   assert.equal((await request({...body('2026-10-14'),dueDate:'2026-11-19'})).status,200);
   assert.equal((await request({...body('2026-10-14'),dueDate:'2026-10-19'})).status,200);
  });
  await t.test('paid SOAs retain the existing open-report requirement and preserve payment values',async()=>{
   await setup.query(`INSERT INTO payment_submissions(id,unit_id,submitted_by,target_unit_bill_id,entry_type,payment_method,payment_purpose,review_status,reviewed_by,reviewed_at,verified_amount,verified_reference_no,verified_payment_date)
    VALUES(500,10,1,100,'MANUAL','CASH','COMBINED','APPROVED',1,NOW(),200,'FIXTURE-PAID','2026-10-10')`);
   await createPaymentAllocations(setup,500);const paidBefore=await financial();
   assert.equal((await request(body('2026-10-16'))).status,409);
   assert.equal((await request({...body('2026-10-16'),billingErrorReportId:999})).status,409);
   const result=await request({...body('2026-10-16'),billingErrorReportId:9});assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.bill.statementDate,'2026-10-16');
   assert.equal(Number(result.data.bill.approvedAmount),200);assert.equal(Number(result.data.bill.remainingBalance),1494.22);assert.deepEqual(await financial(),paidBefore);
  });
  await t.test('an audit failure rolls back date and revision changes',async()=>{
   const originalBill=(await request()).data.bill;const originalFinancial=await financial();
   failAudit=true;try{assert.equal((await request({...body('2026-10-17'),billingErrorReportId:9})).status,503);}finally{failAudit=false;}
   const unchanged=(await request()).data.bill;assert.equal(unchanged.statementDate,originalBill.statementDate);assert.equal(unchanged.soaRevision,originalBill.soaRevision);assert.deepEqual(await financial(),originalFinancial);
   assert.equal(Number((await setup.query('SELECT count(*) FROM soa_email_deliveries')).rows[0].count),0,'No email was queued or sent');
  });
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));pool.query=original.query;pool.connect=original.connect;
  if(original.secret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=original.secret;
  if(created&&/^codex_soa_dates_[a-f0-9]{32}$/.test(schema))await setup.query(`DROP SCHEMA "${schema}" CASCADE`);
  setup.release();await fixtures.end();await pool.end();
 }
});
