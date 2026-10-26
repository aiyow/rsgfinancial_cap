import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import express from 'express';
import jwt from 'jsonwebtoken';
import ExcelJS from 'exceljs';
import pool from '../../config/db.js';
import reportRoutes from '../../routes/financialReportRoutes.js';
import errorHandler from '../../middleware/errorHandler.js';

test('combined financial report, exports and consistent payment-cutoff snapshots',async t=>{
 const schema='codex_combined_'+randomUUID().replaceAll('-','');assert.match(schema,/^codex_combined_[a-f0-9]{32}$/);
 const url=process.env.DATABASE_URL?new URL(process.env.DATABASE_URL):null;if(url)url.hostname=url.hostname.replace('-pooler.','.');
 const fixtures=new pg.Pool({...url?{connectionString:url.toString(),ssl:pool.options.ssl}:pool.options,options:`-c search_path=${schema}`,connectionTimeoutMillis:10000,max:8});
 const setup=await fixtures.connect();const original={query:pool.query,connect:pool.connect,secret:process.env.JWT_SECRET};
 let created=false,server,gate,failRead=false;let rollbacks=0;
 try {
  await setup.query(`CREATE SCHEMA "${schema}"`);created=true;assert.equal((await setup.query('SELECT current_schema() AS schema')).rows[0].schema,schema);
  await setup.query(`CREATE TABLE users(id BIGINT PRIMARY KEY,full_name TEXT,role TEXT,is_active BOOLEAN DEFAULT TRUE,approval_status TEXT DEFAULT 'APPROVED',auth_version INT DEFAULT 0);
   CREATE TABLE units(id BIGINT PRIMARY KEY,unit_number TEXT,floor TEXT,occupancy_status TEXT DEFAULT 'VACANT');
   CREATE TABLE unit_assignments(id BIGINT PRIMARY KEY,unit_id BIGINT,user_id BIGINT,end_date DATE);
   CREATE TABLE billing_periods(id BIGINT PRIMARY KEY,period_type TEXT,status TEXT);
   CREATE TABLE unit_bills(id BIGINT PRIMARY KEY,unit_id BIGINT,billing_period_id BIGINT,unit_number_snapshot TEXT,payer_name_snapshot TEXT,
    period_start_snapshot DATE,period_end_snapshot DATE,due_date_snapshot DATE,published_at TIMESTAMPTZ,late_penalty_amount NUMERIC DEFAULT 0,
    late_penalty_percent_snapshot NUMERIC DEFAULT 0,late_penalty_applied_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT NOW());
   CREATE TABLE bill_charges(id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,unit_bill_id BIGINT,charge_type TEXT,quantity NUMERIC,rate_applied NUMERIC);
   CREATE TABLE payment_submissions(id BIGINT PRIMARY KEY,unit_id BIGINT,review_status TEXT,payment_method TEXT,verified_reference_no TEXT,
    verified_payment_date DATE,verified_amount NUMERIC,payment_purpose TEXT,target_unit_bill_id BIGINT);
   CREATE TABLE payment_charge_allocations(id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,payment_submission_id BIGINT,charge_type TEXT,invoice_number TEXT,allocated_amount NUMERIC);
   CREATE TABLE payment_applications(id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,payment_submission_id BIGINT,unit_bill_id BIGINT,charge_allocation_id BIGINT,component TEXT,amount_applied NUMERIC);
   CREATE TABLE payment_ledger_policy(id INT PRIMARY KEY,version INT);INSERT INTO payment_ledger_policy VALUES(1,2);
   CREATE TABLE audit_logs(context JSONB,actor_user_id BIGINT,entity_name TEXT,entity_id BIGINT,action TEXT,old_values JSONB,new_values JSONB,remarks TEXT);
   INSERT INTO users(id,full_name,role) VALUES(1,'Fixture Admin','ADMIN'),(2,'Current Directory Payer','RESIDENT'),(3,'Fixture Associate','COLLECTOR');
   INSERT INTO units(id,unit_number,floor) SELECT id,(230+id)::text,'2' FROM generate_series(1,143) id;
   UPDATE units SET unit_number=CASE id WHEN 1 THEN '2' WHEN 2 THEN '10' WHEN 3 THEN '11' WHEN 4 THEN '12' WHEN 5 THEN '13' WHEN 6 THEN '14' END WHERE id<=6;
   INSERT INTO unit_assignments VALUES(1,1,2,NULL);
   INSERT INTO billing_periods VALUES(1,'LIVE_BILLING','GENERATED'),(2,'LIVE_BILLING','FORWARDED'),(3,'LIVE_BILLING','CLOSED'),(4,'LIVE_BILLING','DRAFT'),(5,'ANALYTICS_HISTORY','CLOSED');`);
  async function bill(id,unit,period,start,dues,water,{payer='Saved Payer',penalty=0}={}) {
   await setup.query(`INSERT INTO unit_bills(id,unit_id,billing_period_id,unit_number_snapshot,payer_name_snapshot,period_start_snapshot,period_end_snapshot,due_date_snapshot,late_penalty_amount,late_penalty_percent_snapshot,late_penalty_applied_at)
    SELECT $1,$2,$3,unit_number,$4,$5::date,($5::date+INTERVAL '1 month')::date,CASE WHEN $6>0 THEN '2000-01-15'::date ELSE '2099-01-15'::date END,$6,CASE WHEN $6>0 THEN 10 ELSE 0 END,CASE WHEN $6>0 THEN '2026-10-10'::timestamptz ELSE NULL END FROM units WHERE id=$2`,[id,unit,period,payer,start,penalty]);
   await setup.query("INSERT INTO bill_charges(unit_bill_id,charge_type,quantity,rate_applied) VALUES($1,'ASSOCIATION_DUES',1,$2),($1,'WATER',1,$3)",[id,dues,water]);
  }
  await bill(101,1,1,'2026-10-01',100,25,{payer:'Historical Payer'});
  await bill(102,2,2,'2026-10-05',100,10,{payer:'First Snapshot',penalty:10});
  await bill(103,3,3,'2026-10-01',0,20);await bill(104,4,1,'2026-10-01',0,0);
  await bill(105,6,1,'2026-09-01',90,10);await bill(106,1,4,'2026-10-01',999,999);
  await bill(107,2,1,'2026-10-20',7.01,0.02,{payer:'Second Snapshot'});
  await bill(108,3,5,'2026-10-01',999,999);await bill(109,3,1,'2026-11-01',3,2);
  async function payment(id,unit,amount,date,status='APPROVED') {await setup.query(`INSERT INTO payment_submissions(id,unit_id,review_status,payment_method,verified_reference_no,verified_payment_date,verified_amount,payment_purpose)
   VALUES($1::bigint,$2,$3,'CASH',($1::bigint)::text,$4,$5,'COMBINED')`,[id,unit,status,date,amount]);}
  async function apply(id,bill,type,amount){const allocation=(await setup.query('INSERT INTO payment_charge_allocations(payment_submission_id,charge_type,allocated_amount) VALUES($1,$2,$3) RETURNING id',[id,type,amount])).rows[0].id;
   await setup.query("INSERT INTO payment_applications(payment_submission_id,unit_bill_id,charge_allocation_id,component,amount_applied) VALUES($1,$2,$3,'PRINCIPAL',$4)",[id,bill,allocation,amount]);}
  await payment(201,1,50,'2026-10-15');await apply(201,101,'ASSOCIATION_DUES',50);
  await payment(202,1,75,'2026-09-30');await apply(202,101,'ASSOCIATION_DUES',50);await apply(202,101,'WATER',25);
  await payment(203,2,30,'2026-10-20');await apply(203,102,'ASSOCIATION_DUES',30);
  await payment(204,2,60,'2026-11-01');await apply(204,102,'ASSOCIATION_DUES',60);
  await payment(205,2,7.03,'2026-10-22');await apply(205,107,'ASSOCIATION_DUES',7.01);await apply(205,107,'WATER',0.02);
  await payment(206,6,5,'2026-10-01');await apply(206,105,'WATER',5);
  await payment(207,1,100,'2026-10-20'); // Unapplied advance: not paid toward selected bills.
  await payment(208,3,20,'2026-10-20','PENDING');await payment(209,3,15,'2026-10-20','REJECTED');
  async function scoped(){const c=await fixtures.connect();assert.equal((await c.query('SELECT current_schema() AS schema')).rows[0].schema,schema);return c;}
  pool.query=async(sql,values)=>{const c=await scoped();try{return await c.query(sql,values);}finally{c.release();}};
  pool.connect=async()=>{const c=await scoped();let snapshot=false;return{async query(sql,values){
   if(sql==='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')snapshot=true;
   if(sql==='ROLLBACK')rollbacks++;
   if(failRead&&snapshot&&sql.includes('FROM units u'))throw Object.assign(new Error('Simulated report read failure'),{status:503});
   const result=await c.query(sql,values);
   if(snapshot&&gate&&sql.includes('AND b.period_start_snapshot >= $2::date')){const current=gate;current.enter();await current.resumed;}
   return result;
  },release(){c.release();}};};
  process.env.JWT_SECRET='isolated-combined-report-test';const token=id=>jwt.sign({id,authVersion:0},process.env.JWT_SECRET);
  const app=express();app.use('/api/reports',reportRoutes);app.use(errorHandler);server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  async function request(path='/financial?month=2026-10',actor=1){const response=await fetch(`http://127.0.0.1:${server.address().port}/api/reports${path}`,{headers:actor?{Authorization:`Bearer ${token(actor)}`}:{}});
   if(path.includes('/export')&&response.ok)return{status:response.status,buffer:Buffer.from(await response.arrayBuffer())};return{status:response.status,data:await response.json()};}
  let initial;
  await t.test('all units, statuses, snapshots, unpublished generated bills and cutoff-specific approved applications',async()=>{
   assert.equal((await request('/financial?month=2026-10',null)).status,401);assert.equal((await request('/financial?month=2026-10',2)).status,403);
   const result=await request();assert.equal(result.status,200,JSON.stringify(result.data));initial=result.data;const combined=initial.combined;
   assert.equal(combined.rows.length,143);assert.equal(combined.asOfDate,'2026-10-31');
   assert.deepEqual(combined.rows.slice(0,6).map(row=>row.unitNumber),['2','10','11','12','13','14']);
   const byUnit=id=>combined.rows.find(row=>row.unitId===id);
   assert.equal(byUnit(1).status,'PAID');assert.equal(byUnit(1).payerName,'Historical Payer');assert.equal(byUnit(1).paidAmount,125);
   assert.equal(byUnit(2).status,'PARTIAL');assert.equal(byUnit(2).billCount,2);assert.equal(byUnit(2).payerName,'First Snapshot, Second Snapshot');assert.equal(byUnit(2).paidAmount,37.03);assert.equal(byUnit(2).remainingBalance,90);
   assert.equal(byUnit(3).status,'UNPAID');assert.equal(byUnit(4).status,'NO_CHARGES');assert.equal(byUnit(5).status,'NO_SOA');assert.equal(byUnit(6).status,'NO_SOA');
   assert.deepEqual(combined.totals,{duesBilled:207.01,waterBilled:55.02,latePenalty:10,totalBilled:272.03,paidAmount:162.03,remainingBalance:110});
   assert.equal(initial.overview.totalBilling,combined.totals.totalBilled);assert.notEqual(initial.overview.totalCollections,combined.totals.paidAmount);
   for (const section of [initial.dues,initial.water]) {
    assert.deepEqual(section.billedRows.map(row=>row.unitNumber),['2','10','10','11','12']);
    assert.deepEqual(section.billedRows.map(row=>row.billId),[101,102,107,103,104]);
   }
   assert.deepEqual(initial.dues.collectionRows.map(row=>row.unitNumber),['2','10','10']);
   assert.deepEqual(initial.water.collectionRows.map(row=>row.unitNumber),['10','14']);
   assert.deepEqual(initial.paidDues.rows.map(row=>row.unitNumber),['2','10','10','14']);
   assert.deepEqual(initial.occupancy.rows.slice(0,6).map(row=>row.unitNumber),['2','10','11','12','13','14']);
   assert.deepEqual(initial.receivables.map(row=>row.unitNumber),['10','11','14']);
   assert.ok(initial.receivables.some(row=>row.billId===105&&row.periodStart==='2026-09-01'));
   assert.ok(!initial.dues.billedRows.some(row=>row.billId===105));

   assert.equal((await request('/financial?month=2026-10',3)).data.combined.totals.totalBilled,272.03);
   const dir=new URL('../../../artifacts/combined-report/',import.meta.url);await mkdir(dir,{recursive:true});await writeFile(new URL('mock-report.json',dir),JSON.stringify(initial,null,2));
  });
  await t.test('date range aggregates selected SOAs and uses its end-date payment cutoff',async()=>{
   const range=(await request('/financial?startDate=2026-09-01&endDate=2026-10-31')).data.combined;
   assert.equal(range.totals.totalBilled,372.03);assert.equal(range.totals.paidAmount,167.03);assert.equal(range.rows.find(row=>row.unitId===6).remainingBalance,95);
   const november=(await request('/financial?startDate=2026-10-01&endDate=2026-11-30')).data.combined;
   assert.equal(november.rows.find(row=>row.unitId===2).paidAmount,97.03);assert.equal(november.rows.find(row=>row.unitId===3).totalBilled,25);
   assert.equal((await request('/financial?month=bad')).status,400);
  });
  await t.test('Excel exports complete unit rows, matching totals, numeric cells and every existing tab identifier',async()=>{
   for(const [tab,name] of [['combined','Overall Billing'],['overview','Overview'],['dues','Association Dues'],['water','Water Billing'],['paidDues','Paid Monthly Dues'],['receivables','Accounts Receivable'],['occupancy','Unit Occupancy']]){
    const exported=await request(`/financial/export?month=2026-10&tab=${tab}`);assert.equal(exported.status,200,JSON.stringify(exported.data));
    const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(exported.buffer);const sheet=workbook.getWorksheet(name);assert.ok(sheet,name);
    if(tab==='dues'||tab==='water') {
     let header;sheet.eachRow(row=>{if(!header&&row.getCell(1).value==='Unit')header=row.number;});
     assert.deepEqual(Array.from({length:5},(_,i)=>sheet.getCell(header+i+1,1).value),['2','10','10','11','12']);
    }
    if(tab==='receivables')assert.match(sheet.getCell('A2').value,/2026-10-31.*earlier unpaid bills/);
    if(tab==='combined'){let header;sheet.eachRow(row=>{if(row.getCell(1).value==='Unit')header=row.number;});assert.equal(sheet.rowCount-header-1,143);
     const total=sheet.getRow(sheet.rowCount);assert.equal(total.getCell(1).value,'Grand Total');assert.equal(total.getCell(6).value,272.03);assert.equal(total.getCell(7).value,162.03);assert.equal(total.getCell(8).value,110);
     assert.equal(sheet.getCell(header+1,3).type,ExcelJS.ValueType.Number);assert.equal(sheet.pageSetup.printTitlesRow,`${header}:${header}`);
     await writeFile(new URL('../../../artifacts/combined-report/combined-billing-test.xlsx',import.meta.url),exported.buffer);
    }
   }
   assert.equal((await request('/financial/export?month=2026-10&tab=paiddues')).status,200);assert.equal((await request('/financial/export?tab=unknown')).status,400);
  });
  await t.test('a concurrent approval cannot mix old billed rows with new payment totals',async()=>{
   let entered,resume;const waiting=new Promise(resolve=>{entered=resolve;});const resumed=new Promise(resolve=>{resume=resolve;});gate={enter:entered,resumed,resume};
   const pending=request();await Promise.race([waiting,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Snapshot gate timed out')),10000);timer.unref();})]);
   await setup.query('BEGIN');try{await setup.query("UPDATE payment_submissions SET review_status='APPROVED' WHERE id=208");await apply(208,103,'WATER',20);await setup.query('COMMIT');}catch(error){await setup.query('ROLLBACK');throw error;}
   resume();gate=null;const old=(await pending).data.combined;assert.equal(old.rows.find(row=>row.unitId===3).status,'UNPAID');assert.equal(old.totals.paidAmount,162.03);
   const updated=(await request()).data.combined;assert.equal(updated.rows.find(row=>row.unitId===3).status,'PAID');assert.equal(updated.totals.paidAmount,182.03);
  });
  await t.test('failed snapshot reads roll back, release the connection and can be retried',async()=>{
   failRead=true;assert.equal((await request()).status,503);failRead=false;assert.ok(rollbacks>0);assert.equal((await request()).status,200);
  });
 }finally{
  if(gate)gate.resume();
  if(server)await new Promise(resolve=>server.close(resolve));pool.query=original.query;pool.connect=original.connect;
  if(original.secret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=original.secret;
  if(created&&/^codex_combined_[a-f0-9]{32}$/.test(schema))await setup.query(`DROP SCHEMA "${schema}" CASCADE`);
  setup.release();await fixtures.end();await pool.end();
 }
});
