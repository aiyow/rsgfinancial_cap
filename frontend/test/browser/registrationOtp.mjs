// All auth requests are intercepted. No real account or email is used.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const output = fileURLToPath(new URL('../../../artifacts/registration-otp/', import.meta.url))
await mkdir(output, { recursive:true })
const browser = await chromium.launch({ channel:'chrome',headless:true })
const context = await browser.newContext({ viewport:{width:1366,height:900} })
const page = await context.newPage()
const errors=[];page.on('pageerror',error=>errors.push(error.message))
let state
function reset(mode='normal'){state={mode,requests:[],sent:0,verified:false,completed:0}}
const json=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
await context.route('**/api/**',async route=>{
 const req=route.request(),path=new URL(req.url()).pathname,body=req.postDataJSON()
 state.requests.push({path,body})
 if(path==='/api/auth/register/send-otp'){
  assert.equal('password' in body,false);assert.equal('firstName' in body,false)
  if(state.mode==='mail-fail')return json(route,{message:'We could not send your code. Check your email address or try again later.'},503)
  if(state.mode==='duplicate')return json(route,{message:'This email is already registered. Sign in or reset your password.'},409)
  if(state.mode==='already-sent')return json(route,{challengeId:'75dc4fd6-903f-483a-8100-9fbedb23bc84',alreadySent:true,retryAfterSeconds:42,expiresAt:new Date(Date.now()+500000).toISOString()})
  state.sent++;return json(route,{expiresAt:new Date(Date.now()+600000).toISOString(),challengeId:state.sent===1?'75dc4fd6-903f-483a-8100-9fbedb23bc84':'1e35998b-7231-45e6-8817-681768b0cdb7',retryAfterSeconds:60})
 }
 if(path==='/api/auth/register/verify-otp'){
  if(body.otp!=='012345')return json(route,{message:'Incorrect code. 4 attempts remaining.'},400)
  state.verified=true;return json(route,{registrationToken:'t'.repeat(43),expiresAt:new Date(Date.now()+(state.mode==='expired'? -1000:600000)).toISOString()})
 }
 if(path==='/api/auth/register'){
  assert.equal(state.verified,true);assert.equal(body.registrationToken,'t'.repeat(43));assert.equal(body.email,'resident@example.invalid')
  if(state.mode==='stale-grant')return json(route,{message:'Verify your email before creating an account. Your verification may have expired.'},403)
  state.completed++;return json(route,{user:{email:body.email,approvalStatus:'PENDING',emailVerified:true}},201)
 }
 throw new Error(`Unexpected API call ${path}`)
})
async function load(){await page.evaluate(()=>{try{sessionStorage.removeItem('condo_registration_verification')}catch{}});await page.goto(process.env.FRONTEND_URL||'http://localhost:5173/register');await page.getByLabel('Email address',{exact:true}).waitFor()}
async function send(){await page.getByLabel('Email address',{exact:true}).fill('Resident@Example.Invalid');await page.getByRole('button',{name:'Send verification code',exact:true}).click();await page.getByLabel('Verification code',{exact:true}).waitFor()}
async function verify(){await page.getByLabel('Verification code',{exact:true}).fill('012345');await page.getByRole('button',{name:'Verify email',exact:true}).click();await page.getByLabel('First name',{exact:true}).waitFor()}
async function fillDetails(){await page.getByLabel('First name',{exact:true}).fill('Jane');await page.getByLabel('Last name',{exact:true}).fill('Doe');await page.getByLabel('MI (optional)',{exact:true}).fill('JP.');await page.getByLabel('Password',{exact:true}).fill('StrongPass7!xy');await page.getByLabel('Confirm password',{exact:true}).fill('StrongPass7!xy')}
try{
 reset();await load();assert.equal(await page.getByLabel('Password',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Create account',exact:true}).count(),0)
 await page.screenshot({path:`${output}/email-desktop.png`});await send();assert.equal(state.completed,0);assert.equal(await page.getByRole('button',{name:/Resend in/}).isDisabled(),true)
 await page.getByLabel('Verification code',{exact:true}).fill('111111');await page.getByRole('button',{name:'Verify email',exact:true}).click();await page.getByRole('alert').filter({hasText:'Incorrect code.'}).waitFor();assert.equal(await page.getByLabel('First name',{exact:true}).count(),0)
 await page.screenshot({path:`${output}/otp-desktop.png`});await verify();assert.equal(state.completed,0);await fillDetails()
 assert.equal(await page.getByLabel('First name',{exact:true}).getAttribute('maxlength'),'100');assert.equal(await page.getByLabel('Last name',{exact:true}).getAttribute('maxlength'),'100')
 await page.screenshot({path:`${output}/details-desktop.png`});await page.getByRole('button',{name:'Create account',exact:true}).click();await page.getByRole('heading',{name:'Account awaiting approval'}).waitFor();assert.equal(state.completed,1);assert.equal(await page.getByRole('link',{name:'Verify by email'}).count(),0)
 console.log('PASS email-first signup, OTP errors/cooldown, name/password form and Admin-approval confirmation')

 reset();await load();await send();await verify();await fillDetails();await page.getByRole('button',{name:'Change email',exact:true}).click();await page.getByLabel('Email address',{exact:true}).waitFor();assert.equal(await page.getByLabel('Password',{exact:true}).count(),0);assert.equal(state.completed,0)
 await page.reload();await page.getByLabel('Email address',{exact:true}).waitFor();assert.equal(await page.getByLabel('First name',{exact:true}).count(),0)
 console.log('PASS changing email discards proof and password; reload starts with verification')

 reset();await load();await send();const sendsBefore=state.sent
 const stored=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('condo_registration_verification')))
 assert.equal(stored.email,'resident@example.invalid');assert.equal('otp' in stored,false);assert.equal('password' in stored,false);assert.equal('registrationToken' in stored,false)
 await page.reload();await page.getByLabel('Verification code',{exact:true}).waitFor();assert.equal(state.sent,sendsBefore)
 await page.getByRole('link',{name:'Back to sign in',exact:true}).click();await page.waitForURL('**/login');await page.goBack();await page.getByLabel('Verification code',{exact:true}).waitFor()
 assert.equal(state.sent,sendsBefore);assert.equal(await page.getByRole('button',{name:/Resend in/}).isDisabled(),true)
 await verify();assert.equal(await page.evaluate(()=>sessionStorage.getItem('condo_registration_verification')),null)
 console.log('PASS refresh and browser Back restore the existing OTP challenge without sending another email')

 reset('already-sent');await load();await send();assert.equal(state.sent,0);assert.equal(await page.getByRole('alert').count(),0);assert.equal(await page.getByRole('button',{name:/Resend in/}).isDisabled(),true);await verify()
 console.log('PASS a cooldown response proceeds to code entry using the already-sent code')


 for(const [mode,message] of [['mail-fail','We could not send your code.'],['duplicate','This email is already registered.']]){
  reset(mode);await load();await page.getByLabel('Email address',{exact:true}).fill('resident@example.invalid');await page.getByRole('button',{name:'Send verification code',exact:true}).click();await page.getByRole('alert').filter({hasText:message}).waitFor();assert.equal(await page.getByLabel('Verification code',{exact:true}).count(),0);assert.equal(state.completed,0)
 }
 reset('expired');await load();await send();await verify();await page.getByRole('alert').filter({hasText:'Email verification expired.'}).waitFor();assert.equal(await page.getByRole('button',{name:'Create account',exact:true}).isDisabled(),true)
 reset('stale-grant');await load();await send();await verify();await fillDetails();await page.getByRole('button',{name:'Create account',exact:true}).click();await page.getByRole('button',{name:'Verify email again',exact:true}).waitFor();assert.equal(state.completed,0);assert.equal(await page.getByRole('button',{name:'Create account',exact:true}).isDisabled(),true)
 console.log('PASS delivery failures, duplicate email, expired proofs and stale server rejection fail closed')


 await page.setViewportSize({width:390,height:844});reset();await load();await page.screenshot({path:`${output}/email-mobile.png`});await send();await page.screenshot({path:`${output}/otp-mobile.png`});await verify();await fillDetails();await page.screenshot({path:`${output}/details-mobile.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 await page.getByRole('button',{name:'Create account',exact:true}).click();await page.getByRole('heading',{name:'Account awaiting approval'}).waitFor()
 assert.deepEqual(errors,[]);console.log('All mocked registration browser checks passed, including mobile. No real emails or accounts created.')
}finally{await browser.close()}
