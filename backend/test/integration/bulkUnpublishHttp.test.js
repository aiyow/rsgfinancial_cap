import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import pg from 'pg';
import pool from '../../config/db.js';
import routes from '../../routes/billingPeriodRoutes.js';
import { hashPassword } from '../../services/passwordHash.js';
import errorHandler from '../../middleware/errorHandler.js';

// Direct connections and a private startup search_path keep all mutations in a
// disposable schema. Never publish/unpublish real SOAs or send real emails.
test('password-protected bulk SOA unpublishing is authorized, atomic and serialized', async t => {
  const schema = 'codex_bulk_unpublish_' + randomUUID().replaceAll('-', '');
  assert.match(schema, /^codex_bulk_unpublish_[a-f0-9]{32}$/);
  const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
  if (url) url.hostname = url.hostname.replace('-pooler.', '.');
  const fixtures = new pg.Pool({ ...(url ? { connectionString:url.toString(),ssl:pool.options.ssl } : pool.options),
    options:`-c search_path=${schema}`,max:8,connectionTimeoutMillis:10000 });
  const setup = await fixtures.connect();
  const original = { query:pool.query,connect:pool.connect,secret:process.env.JWT_SECRET };
  const passwords = ['FixtureAdmin9!long','OtherFixtureAdmin8!'];
  let created=false,server,failAudit=false,periodEntered;
  const hash = await hashPassword(passwords[0]), legacyHash = await bcrypt.hash(passwords[1],4);
  try {
    await setup.query(`CREATE SCHEMA "${schema}"`);created=true;
    assert.equal((await setup.query('SELECT current_schema() AS schema')).rows[0].schema,schema);
    await setup.query(`CREATE TABLE users(id BIGINT PRIMARY KEY,full_name TEXT,role TEXT,password_hash TEXT,
      is_active BOOLEAN DEFAULT TRUE,approval_status TEXT DEFAULT 'APPROVED',auth_version INT DEFAULT 0);
      CREATE TABLE units(id BIGINT PRIMARY KEY,unit_number TEXT);
      CREATE TABLE billing_periods(id BIGINT PRIMARY KEY,period_type TEXT DEFAULT 'LIVE_BILLING',status TEXT);
      CREATE TABLE unit_bills(id BIGINT PRIMARY KEY,unit_id BIGINT REFERENCES units,billing_period_id BIGINT REFERENCES billing_periods,
        published_at TIMESTAMPTZ,published_by BIGINT,amount NUMERIC);
      CREATE TABLE soa_email_deliveries(id BIGINT PRIMARY KEY,unit_bill_id BIGINT REFERENCES unit_bills,status TEXT,recipient_email TEXT);
      CREATE TABLE user_notifications(id BIGINT PRIMARY KEY,notification_type TEXT,href TEXT,dedupe_key TEXT);
      ALTER TABLE unit_bills ADD COLUMN unit_number_snapshot TEXT, ADD COLUMN period_start_snapshot DATE, ADD COLUMN period_end_snapshot DATE;
      CREATE TABLE audit_logs(context JSONB,id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor_user_id BIGINT,actor_name_snapshot TEXT,
        actor_role_snapshot TEXT,entity_name TEXT,entity_id BIGINT,action TEXT,old_values JSONB,new_values JSONB,remarks TEXT);
      CREATE TABLE meter_readings(id BIGINT PRIMARY KEY,previous_reading NUMERIC,current_reading NUMERIC,validation_status TEXT);
      CREATE TABLE bill_charges(id BIGINT PRIMARY KEY,unit_bill_id BIGINT,amount NUMERIC);
      CREATE TABLE payment_submissions(id BIGINT PRIMARY KEY,review_status TEXT,amount NUMERIC);
      CREATE TABLE payment_applications(id BIGINT PRIMARY KEY,payment_submission_id BIGINT,unit_bill_id BIGINT,amount_applied NUMERIC);
      INSERT INTO units SELECT n,(230+n)::text FROM generate_series(1,143) n;
      INSERT INTO billing_periods(id,status) VALUES(42,'FORWARDED'),(43,'FORWARDED'),(44,'DRAFT'),(45,'CLOSED'),(46,'GENERATED'),(48,'FORWARDED');
      INSERT INTO billing_periods VALUES(47,'ANALYTICS_HISTORY','FORWARDED');
      INSERT INTO unit_bills SELECT 1000+n,n,42,NOW(),1,100+n/100.0 FROM generate_series(1,143) n;
      INSERT INTO unit_bills VALUES(2011,1,43,NOW(),1,250),(2012,2,44,NOW(),1,10),(2013,3,45,NOW(),1,20);
      INSERT INTO soa_email_deliveries SELECT n,1000+n,CASE WHEN n%2=0 THEN 'PENDING' ELSE 'SENT' END,'fixture@example.invalid' FROM generate_series(1,143) n;
      INSERT INTO soa_email_deliveries VALUES(999,2011,'PENDING','other@example.invalid');
      INSERT INTO user_notifications SELECT n,'SOA_PUBLISHED','/resident/bills/'||(1000+n),'soa-published:'||(1000+n) FROM generate_series(1,143) n;
      INSERT INTO user_notifications VALUES(999,'SOA_PUBLISHED','/resident/bills/2011','soa-published:2011'),(998,'PAYMENT_APPROVED','/resident/bills/1001','payment:1');
      INSERT INTO meter_readings VALUES(1,100,110,'VALID'),(2,10,0,'FLAGGED');
      INSERT INTO bill_charges SELECT id,id,amount FROM unit_bills;
      INSERT INTO payment_submissions VALUES(1,'APPROVED',55.50),(2,'PENDING',100);
      INSERT INTO payment_applications VALUES(1,1,1001,55.50);`);
    await setup.query(`INSERT INTO users(id,full_name,role,password_hash) VALUES
      (1,'Fixture Admin','ADMIN',$1),(2,'Other Admin','ADMIN',$2),(3,'Fixture Associate','COLLECTOR',$1),(4,'Fixture Resident','RESIDENT',$1),
      (5,'Inactive Admin','ADMIN',$1),(6,'Unapproved Admin','ADMIN',$1)`,[hash,legacyHash]);
    await setup.query("UPDATE users SET is_active=FALSE WHERE id=5;UPDATE users SET approval_status='PENDING' WHERE id=6;");
    async function scoped() {const c=await fixtures.connect();assert.equal((await c.query('SELECT current_schema() AS schema')).rows[0].schema,schema);return c;}
    pool.query=async(sql,values)=>{const c=await scoped();try{return await c.query(sql,values);}finally{c.release();}};
    pool.connect=async()=>{const c=await scoped();return{async query(sql,values){
      if(failAudit&&sql.includes('INSERT INTO audit_logs'))throw Object.assign(new Error('Simulated audit failure'),{status:503});
      if(periodEntered&&sql.includes('FROM billing_periods WHERE id = $1')&&sql.includes('FOR UPDATE'))periodEntered();
      return c.query(sql,values);
    },release(){c.release();}};};
    process.env.JWT_SECRET='private-bulk-unpublish-test';
    const app=express();app.use(express.json());app.use('/api/billing-periods',routes);app.use(errorHandler);
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    async function request(id=42,body={currentPassword:passwords[0]},actor=1) {
      const token=actor?jwt.sign({id:actor,authVersion:0},process.env.JWT_SECRET):null;
      const response=await fetch(`http://127.0.0.1:${server.address().port}/api/billing-periods/${id}/unpublish`,{
        method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body) });
      return{status:response.status,data:await response.json()};
    }
    const published=async()=>Number((await setup.query('SELECT count(*) FROM unit_bills WHERE billing_period_id=42 AND published_at IS NOT NULL')).rows[0].count);
    const count=async table=>Number((await setup.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
    const fingerprint=async()=> (await setup.query(`SELECT md5(jsonb_build_object(
      'bills',(SELECT jsonb_agg(to_jsonb(b)-'published_at'-'published_by' ORDER BY id) FROM unit_bills b),
      'readings',(SELECT jsonb_agg(m ORDER BY id) FROM meter_readings m),
      'charges',(SELECT jsonb_agg(c ORDER BY id) FROM bill_charges c),
      'payments',(SELECT jsonb_agg(p ORDER BY id) FROM payment_submissions p),
      'applications',(SELECT jsonb_agg(a ORDER BY id) FROM payment_applications a))::text) AS hash`)).rows[0].hash;
    const financialBefore=await fingerprint();
    await t.test('only approved active Admins with their own current password may proceed',async()=>{
      for(const [actor,status] of [[null,401],[3,403],[4,403],[5,401],[6,401]])assert.equal((await request(42,{},actor)).status,status);
      for(const body of [{},{currentPassword:''},{currentPassword:'a'.repeat(257)},{currentPassword:123},{currentPassword:passwords[0],billIds:[1001]}])assert.equal((await request(42,body)).status,400);
      assert.equal((await request(42,{currentPassword:'wrong-password'})).status,403);
      assert.equal((await request(42,{currentPassword:passwords[1]})).status,403);
      assert.equal((await request('invalid')).status,400);assert.equal((await request(999)).status,404);
      assert.equal(await published(),143);assert.equal(await count('soa_email_deliveries'),144);assert.equal(await count('audit_logs'),0);
    });
    await t.test('empty, partial, draft, generated and history batches cannot be bulk unpublished',async()=>{
      for(const id of [44,46,48])assert.equal((await request(id)).status,409);
      assert.equal((await request(47)).status,404);
      await setup.query('UPDATE unit_bills SET published_at=NULL,published_by=NULL WHERE id=1002');
      assert.equal((await request()).status,409);assert.equal(await published(),142);
      await setup.query('UPDATE unit_bills SET published_at=NOW(),published_by=1 WHERE id=1002');
      assert.equal(await count('soa_email_deliveries'),144);assert.equal(await count('audit_logs'),0);
    });
    await t.test('audit failure rolls back every visibility, notification and delivery change',async()=>{
      failAudit=true;try {assert.equal((await request()).status,503);}finally{failAudit=false;}
      assert.equal(await published(),143);assert.equal(await count('soa_email_deliveries'),144);assert.equal(await count('user_notifications'),145);assert.equal(await count('audit_logs'),0);
    });
    await t.test('stale dialogs recheck publication after waiting for the batch transaction',async()=>{
      await setup.query('BEGIN');await setup.query('SELECT id FROM billing_periods WHERE id=42 FOR UPDATE');
      await setup.query('UPDATE unit_bills SET published_at=NULL,published_by=NULL WHERE id=1002');
      let entered;const waiting=new Promise(resolve=>{entered=resolve;});periodEntered=entered;
      const pending=request();
      try {await Promise.race([waiting,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Period lock wait timed out')),10000);timer.unref();})]);}
      finally{periodEntered=null;await setup.query('COMMIT');}
      assert.equal((await pending).status,409);assert.equal(await published(),142);assert.equal(await count('audit_logs'),0);
      await setup.query('UPDATE unit_bills SET published_at=NOW(),published_by=1 WHERE id=1002');
    });
    await t.test('all 143 SOAs are hidden atomically; unrelated records and financial values stay intact',async()=>{
      const result=await request();assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.unpublishedCount,143);assert.equal(result.data.cancelledEmailDeliveries,143);
      assert.equal(await published(),0);assert.equal(Number((await setup.query('SELECT count(*) FROM unit_bills WHERE billing_period_id=42 AND published_by IS NOT NULL')).rows[0].count),0);
      assert.equal(await count('soa_email_deliveries'),1);assert.equal(await count('user_notifications'),2);
      assert.ok((await setup.query('SELECT published_at FROM unit_bills WHERE id=2011')).rows[0].published_at);
      assert.equal((await setup.query('SELECT status FROM billing_periods WHERE id=42')).rows[0].status,'FORWARDED');
      const audit=(await setup.query("SELECT * FROM audit_logs WHERE action='UNPUBLISHED'")).rows[0];
      assert.equal(audit.actor_user_id, '1');assert.equal(audit.new_values.mode,'ALL');assert.equal(audit.old_values.bills.length,143);
      assert.ok(!JSON.stringify(audit).includes(passwords[0]));assert.ok(!JSON.stringify(result.data).includes(passwords[0]));
      assert.equal(await fingerprint(),financialBefore);assert.equal((await request()).status,409);
    });
    await t.test('simultaneous Admin confirmations serialize; closed batches also support legacy passwords',async()=>{
      await setup.query('UPDATE unit_bills SET published_at=NOW(),published_by=1 WHERE billing_period_id=42');
      const results=await Promise.all([request(),request(42,{currentPassword:passwords[1]},2)]);
      assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(await published(),0);
      assert.equal(await count('audit_logs'),2);
      assert.equal((await request(45,{currentPassword:passwords[1]},2)).status,200);
      assert.equal((await setup.query('SELECT published_at FROM unit_bills WHERE id=2013')).rows[0].published_at,null);
      assert.equal(await fingerprint(),financialBefore);
    });
  } finally {
    periodEntered=null;
    if(server)await new Promise(resolve=>server.close(resolve));pool.query=original.query;pool.connect=original.connect;
    if(original.secret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=original.secret;
    await setup.query('ROLLBACK').catch(()=>{});
    if(created&&/^codex_bulk_unpublish_[a-f0-9]{32}$/.test(schema))await setup.query(`DROP SCHEMA "${schema}" CASCADE`);
    setup.release();await fixtures.end();await pool.end();
  }
});
