import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import nodemailer from 'nodemailer';
import pool from '../../config/db.js';
import authRoutes from '../../routes/authRoutes.js';
import userRoutes from '../../routes/userRoutes.js';
import errorHandler from '../../middleware/errorHandler.js';
import { registrationHash, cleanupRegistrationData } from "../../services/accounts.js";
import { hashVerificationToken } from "../../services/email.js";

test('email-first signup, durable limits, one-time verification and separate approval',async t=>{
 const schema='codex_registration_'+randomUUID().replaceAll('-','');
 assert.match(schema,/^codex_registration_[a-f0-9]{32}$/);
 const url=process.env.DATABASE_URL?new URL(process.env.DATABASE_URL):null;
 if(url)url.hostname=url.hostname.replace('-pooler.','.');
 const fixtures=new pg.Pool({...url?{connectionString:url.toString(),ssl:pool.options.ssl}:pool.options,options:`-c search_path=${schema}`,connectionTimeoutMillis:10000,max:8});
 const setup=await fixtures.connect();
 const original={query:pool.query,connect:pool.connect,transport:nodemailer.createTransport};
 const keys=['JWT_SECRET','SMTP_HOST','SMTP_USER','SMTP_PASSWORD','SMTP_FROM'];
 const environment=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 const mail=[];let server,created=false,failMail=false,failNotifications=false;
 try {
  await setup.query(`CREATE SCHEMA "${schema}"`);created=true;
  assert.equal((await setup.query('SELECT current_schema() AS schema')).rows[0].schema,schema);
  await setup.query(`CREATE TABLE users(LIKE public.users INCLUDING DEFAULTS);ALTER TABLE users ADD PRIMARY KEY(id);
   CREATE SEQUENCE fixture_user_ids START 1000;ALTER TABLE users ALTER COLUMN id SET DEFAULT nextval('fixture_user_ids');
   CREATE UNIQUE INDEX fixture_email_unique ON users(LOWER(email));
   CREATE TABLE user_notifications(id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,recipient_user_id BIGINT REFERENCES users,
    notification_type TEXT,title TEXT,message TEXT,href TEXT,dedupe_key TEXT,UNIQUE(recipient_user_id,dedupe_key));
   CREATE TABLE unit_assignments(id BIGINT,user_id BIGINT);
   CREATE TABLE audit_logs(context JSONB,actor_user_id BIGINT,actor_name_snapshot TEXT,actor_role_snapshot TEXT,entity_name TEXT,entity_id BIGINT,action TEXT,old_values JSONB,new_values JSONB,remarks TEXT);`);
  await setup.query((await readFile(new URL('../../database/migrations/039_registration_email_otp.sql',import.meta.url),'utf8')).replaceAll('public.',''));
  const hash=await bcrypt.hash('LegacyAdmin7!xy',4);
  await setup.query(`INSERT INTO users(id,full_name,email,password_hash,role,approval_status,email_verified) VALUES
   (1,'Fixture Admin','admin@example.invalid',$1,'ADMIN','APPROVED',TRUE),
   (2,'Verified Pending','pending@example.invalid',$1,'RESIDENT','PENDING',TRUE),
   (3,'Legacy Pending','legacy@example.invalid',$1,'RESIDENT','PENDING',FALSE)`,[hash]);
  process.env.JWT_SECRET='isolated-signup-secret';
  Object.assign(process.env,{SMTP_HOST:'smtp.invalid',SMTP_USER:'fixture',SMTP_PASSWORD:'fixture',SMTP_FROM:'fixture@example.invalid'});
  nodemailer.createTransport=()=>({async sendMail(message){if(failMail)throw new Error('Simulated delivery failure');mail.push(message);}});
  async function scoped(){const client=await fixtures.connect();assert.equal((await client.query('SELECT current_schema() AS schema')).rows[0].schema,schema);return client;}
  pool.query=async(sql,values)=>{const c=await scoped();try{return await c.query(sql,values);}finally{c.release();}};
  pool.connect=async()=>{const c=await scoped();return{query(sql,values){if(failNotifications&&sql.includes('INSERT INTO user_notifications'))throw Object.assign(new Error('Simulated notification failure'),{status:503});return c.query(sql,values);},release(){c.release();}};};
  const app=express();app.use(express.json());app.use('/api/auth',authRoutes);app.use('/api/users',userRoutes);app.use(errorHandler);
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  async function request(path,body,token,method=body?'POST':'GET'){
   const response=await fetch(`http://127.0.0.1:${server.address().port}/api/${path}`,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
   return{status:response.status,data:await response.json(),retry:response.headers.get('Retry-After')};
  }
  const send=email=>request('auth/register/send-otp',{email});
  const verify=(email,id,otp)=>request('auth/register/verify-otp',{email,challengeId:id,otp});
  const details=(email,registrationToken)=>({firstName:'Signup',middleInitial:'JP.',lastName:'Fixture',email,password:'StrongPass7!xy',registrationToken});
  const register=(email,token)=>request('auth/register',details(email,token));
  const code=()=>mail.at(-1).text.match(/code is: (\d{6})/)[1];
  const count=async email=>(await setup.query('SELECT COUNT(*)::int AS n FROM users WHERE email=$1',[email])).rows[0].n;
  const resetLimits=()=>setup.query('DELETE FROM registration_rate_limits');
  async function ready(email){const sent=await send(email);assert.equal(sent.status,200,JSON.stringify(sent.data));const result=await verify(email,sent.data.challengeId,code());assert.equal(result.status,200,JSON.stringify(result.data));return result.data.registrationToken;}
  async function seedQuota(action,identity,count,seconds=3600){await setup.query(`INSERT INTO registration_rate_limits(key_hash,expires_at,request_count) VALUES($1,NOW()+make_interval(secs=>$2),$3)
   ON CONFLICT(key_hash) DO UPDATE SET expires_at=EXCLUDED.expires_at,request_count=EXCLUDED.request_count`,[registrationHash('quota',action,identity),seconds,count]);}
  const adminToken=jwt.sign({id:1,authVersion:0},process.env.JWT_SECRET);

  await t.test('no user before verification; missing/forged proofs cannot bypass signup',async()=>{
   const email='first@example.invalid';
   assert.equal((await request('auth/register',{firstName:'Bypass',lastName:'Fixture',email,password:'StrongPass7!xy'})).status,400);
   assert.equal((await register(email,'x'.repeat(43))).status,403);assert.equal(await count(email),0);
   const sent=await send(' FIRST@EXAMPLE.INVALID ');assert.equal(sent.status,200);assert.equal(await count(email),0);
   const c=(await setup.query('SELECT * FROM registration_challenges WHERE email=$1',[email])).rows[0];
   assert.notEqual(c.otp_hash,code());assert.equal(c.otp_hash.length,64);assert.equal(c.verified_token_hash,null);
   assert.ok(new Date(c.expires_at)-Date.now()<=600000);assert.equal('password_hash' in c,false);assert.equal(JSON.stringify(sent.data).includes(code()),false);
   const wrong=code()==='000000'?'000001':'000000';assert.equal((await verify(email,sent.data.challengeId,wrong)).status,400);
   assert.equal((await setup.query('SELECT attempts FROM registration_challenges WHERE email=$1',[email])).rows[0].attempts,1);
   assert.equal((await verify('different@example.invalid',sent.data.challengeId,code())).status,400);
   const verified=await verify(email,sent.data.challengeId,code());assert.equal(verified.status,200);const token=verified.data.registrationToken;
   assert.equal(await count(email),0);assert.equal((await verify(email,sent.data.challengeId,code())).status,400);
   assert.equal((await register('different@example.invalid',token)).status,403);
   const saved=await register(email,token);assert.equal(saved.status,201,JSON.stringify(saved.data));assert.equal(saved.data.user.emailVerified,true);assert.equal(saved.data.user.approvalStatus,'PENDING');
   assert.equal(saved.data.token,undefined);assert.equal((await register(email,token)).status,403);assert.equal(await count(email),1);
   assert.equal((await setup.query('SELECT COUNT(*)::int AS n FROM registration_challenges WHERE email=$1',[email])).rows[0].n,0);
   assert.equal((await setup.query('SELECT COUNT(*)::int AS n FROM user_notifications WHERE dedupe_key=$1',[`account-approval:${saved.data.user.id}`])).rows[0].n,1);
   const pendingLogin=await request('auth/login',{email,password:'StrongPass7!xy'});assert.equal(pendingLogin.status,403);assert.equal(pendingLogin.data.code,'ACCOUNT_APPROVAL_REQUIRED');
   const forgedPendingSession=jwt.sign({id:saved.data.user.id,authVersion:0},process.env.JWT_SECRET);
   assert.equal((await request('auth/me',undefined,forgedPendingSession)).status,401);
   assert.equal((await request('auth/forgot-password',{email})).status,403);
   assert.equal((await request(`users/${saved.data.user.id}`,{approvalStatus:'APPROVED'},adminToken,'PATCH')).status,200);
   const login=await request('auth/login',{email,password:'StrongPass7!xy'});assert.equal(login.status,200);assert.equal((await request('auth/me',undefined,login.data.token)).status,200);
  });
  await t.test('legacy email links and verified pending accounts cannot bypass Admin approval',async()=>{
   await resetLimits();
   assert.equal((await request('auth/login',{email:'pending@example.invalid',password:'LegacyAdmin7!xy'})).status,403);
   await setup.query('UPDATE users SET email_verification_token_hash=$1,email_verification_expires_at=NOW()+INTERVAL \'1 hour\' WHERE id=3',[hashVerificationToken('legacy-fixture-link')]);
   assert.equal((await request('auth/verify-email?token=legacy-fixture-link')).status,200);
   assert.equal((await setup.query('SELECT approval_status FROM users WHERE id=3')).rows[0].approval_status,'PENDING');
   assert.equal((await request('auth/login',{email:'legacy@example.invalid',password:'LegacyAdmin7!xy'})).status,403);
   assert.equal((await request('auth/login',{email:'admin@example.invalid',password:'LegacyAdmin7!xy'})).status,200);
   assert.equal((await send('first@example.invalid')).status,409);
  });
  await t.test('cooldown, resend invalidation, five attempts, code expiry and grant expiry',async()=>{
   await resetLimits();const email='limits@example.invalid';let sent=await send(email);const old=code(),oldId=sent.data.challengeId;const before=mail.length;
   const cooldown=await send(email);assert.equal(cooldown.status,200);assert.equal(cooldown.data.alreadySent,true);assert.equal(cooldown.data.challengeId,oldId);assert.ok(cooldown.data.retryAfterSeconds>0);assert.equal(mail.length,before);
   await setup.query("UPDATE registration_challenges SET last_sent_at=NOW()-INTERVAL '2 minutes' WHERE email=$1",[email]);
   sent=await send(email);assert.equal(sent.status,200);assert.notEqual(sent.data.challengeId,oldId);assert.equal((await verify(email,oldId,old)).status,400);
   const valid=code(),wrong=valid==='000000'?'000001':'000000';
   for(let i=0;i<5;i++)assert.equal((await verify(email,sent.data.challengeId,wrong)).status,i===4?429:400);
   assert.equal((await verify(email,sent.data.challengeId,valid)).status,429);assert.equal(await count(email),0);
   const locked=await send(email);assert.equal(locked.status,429);assert.equal(locked.data.challengeId,undefined);
   await setup.query("UPDATE registration_challenges SET last_sent_at=NOW()-INTERVAL '2 minutes' WHERE email=$1",[email]);sent=await send(email);
   await setup.query("UPDATE registration_challenges SET expires_at=NOW()-INTERVAL '1 second' WHERE email=$1",[email]);assert.equal((await verify(email,sent.data.challengeId,code())).status,400);
   await resetLimits();const expEmail='expired-grant@example.invalid';const token=await ready(expEmail);
   await setup.query("UPDATE registration_challenges SET expires_at=NOW()-INTERVAL '1 second' WHERE email=$1",[expEmail]);assert.equal((await register(expEmail,token)).status,403);assert.equal(await count(expEmail),0);
  });
  await t.test('mail and notification failures roll back; the verified grant survives failed account creation',async()=>{
   await resetLimits();failMail=true;const email='mail-failure@example.invalid';assert.equal((await send(email)).status,503);failMail=false;
   assert.equal((await setup.query('SELECT COUNT(*)::int AS n FROM registration_challenges WHERE email=$1',[email])).rows[0].n,0);assert.equal(await count(email),0);
   const sent=await send('resend-failure@example.invalid');const originalCode=code();
   await setup.query("UPDATE registration_challenges SET last_sent_at=NOW()-INTERVAL '2 minutes' WHERE email='resend-failure@example.invalid'");
   failMail=true;assert.equal((await send('resend-failure@example.invalid')).status,503);failMail=false;
   assert.equal((await verify('resend-failure@example.invalid',sent.data.challengeId,originalCode)).status,200);
   const token=await ready(email);failNotifications=true;assert.equal((await register(email,token)).status,503);failNotifications=false;assert.equal(await count(email),0);
   assert.equal((await setup.query('SELECT COUNT(*)::int AS n FROM registration_challenges WHERE email=$1 AND verified_token_hash IS NOT NULL',[email])).rows[0].n,1);
   assert.equal((await register(email,token)).status,201);
  });
  await t.test('persistent email/IP quotas prevent bulk sends and verification/completion floods',async()=>{
   await resetLimits();const email='quota@example.invalid';await seedQuota('send-email',email,5);let before=mail.length;
   assert.equal((await send(email)).status,429);assert.equal(mail.length,before);
   const ip='127.0.0.1';await seedQuota('send-ip',ip,20);assert.equal((await send('other-quota@example.invalid')).status,429);assert.equal(mail.length,before);
   await resetLimits();const sent=await send('verify-quota@example.invalid');const otp=code();await seedQuota('verify-ip',ip,60,900);
   assert.equal((await verify('verify-quota@example.invalid',sent.data.challengeId,otp)).status,429);
   await resetLimits();const token=(await verify('verify-quota@example.invalid',sent.data.challengeId,otp)).data.registrationToken;
   await seedQuota('complete-ip',ip,10);assert.equal((await register('verify-quota@example.invalid',token)).status,429);assert.equal(await count('verify-quota@example.invalid'),0);
   await seedQuota('complete-ip',ip,9);assert.equal((await register('verify-quota@example.invalid',token)).status,201);
  });
  await t.test('concurrent sends and grant redemption serialize and create only one account',async()=>{
   await resetLimits();const email='concurrent@example.invalid',before=mail.length;
   const sends=await Promise.all([send(email),send(email)]);assert.deepEqual(sends.map(r=>r.status),[200,200]);assert.equal(sends.filter(r=>r.data.alreadySent).length,1);assert.equal(sends[0].data.challengeId,sends[1].data.challengeId);assert.equal(mail.length,before+1);
   const sent=sends.find(r=>r.status===200);const verifies=await Promise.all([verify(email,sent.data.challengeId,code()),verify(email,sent.data.challengeId,code())]);
   assert.deepEqual(verifies.map(r=>r.status).sort(),[200,400]);const token=verifies.find(r=>r.status===200).data.registrationToken;
   const saves=await Promise.all([register(email,token),register(email,token)]);assert.deepEqual(saves.map(r=>r.status).sort(),[201,403]);assert.equal(await count(email),1);
  });
  await t.test('expired temporary records and quotas are cleaned without changing accounts',async()=>{
   const before=(await setup.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n;
   await setup.query("UPDATE registration_challenges SET expires_at=NOW()-INTERVAL '1 second'");await setup.query("UPDATE registration_rate_limits SET expires_at=NOW()-INTERVAL '1 second'");
   await cleanupRegistrationData(setup);
   assert.equal((await setup.query('SELECT COUNT(*)::int AS n FROM registration_challenges')).rows[0].n,0);
   assert.equal((await setup.query('SELECT COUNT(*)::int AS n FROM registration_rate_limits')).rows[0].n,0);
   assert.equal((await setup.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n,before);
  });
 } finally {
  if(server)await new Promise(resolve=>server.close(resolve));pool.query=original.query;pool.connect=original.connect;nodemailer.createTransport=original.transport;
  for(const key of keys){if(environment[key]===undefined)delete process.env[key];else process.env[key]=environment[key];}
  if(created&&/^codex_registration_[a-f0-9]{32}$/.test(schema))await setup.query(`DROP SCHEMA "${schema}" CASCADE`);
  setup.release();await fixtures.end();await pool.end();
 }
});
