// Every API call is mocked; this test never unpublishes real SOAs.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const output = fileURLToPath(new URL('../../../artifacts/bulk-unpublish/',import.meta.url))
await mkdir(output,{recursive:true})
const makeBills = () => Array.from({length:143},(_,i)=>({id:1001+i,unitNumber:String(231+i),payerName:'Fixture Resident',
  dueDate:'2026-10-31',publishedAt:'2026-10-10T00:00:00Z',publishedBy:1,totalAmount:100+i,emailDelivery:{sent:1,failed:0,pending:0}}))
let bills=makeBills(),mode='wrong',calls=0,release
const browser=await chromium.launch({channel:'chrome',headless:true})
const errors=[]
try {
 const context=await browser.newContext({viewport:{width:1366,height:900}})
 const user={id:1,role:'ADMIN',fullName:'Fixture Admin',isActive:true,approvalStatus:'APPROVED'}
 await context.addInitScript(user=>{localStorage.setItem('condo_token','mock-only');localStorage.setItem('condo_user',JSON.stringify(user))},user)
 await context.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname
  const respond=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
  if(req.method()==='GET') {
   if(path==='/api/auth/me')return respond({user})
   if(path==='/api/notifications')return respond({notifications:[],unreadCount:0})
   if(path==='/api/bills')return respond({bills})
  }
  assert.equal(req.method(),'POST');assert.equal(path,'/api/billing-periods/42/unpublish')
  assert.equal(req.headers().authorization,'Bearer mock-only')
  const body=req.postDataJSON();assert.deepEqual(Object.keys(body),['currentPassword']);calls++
  if(mode==='wrong')return respond({message:'Your current password is incorrect. No SOAs were unpublished.'},403)
  if(mode==='conflict')return respond({message:'Unpublish All requires every SOA in the batch to be published. Refresh the batch and try again.'},409)
  assert.equal(body.currentPassword,'FixtureAdmin9!long')
  await new Promise(resolve=>{release=resolve})
  bills=bills.map(bill=>({...bill,publishedAt:null,publishedBy:null,emailDelivery:null}))
  return respond({message:'Unpublished 143 SOA(s). They are now hidden from resident dashboards.',unpublishedCount:143,cancelledEmailDeliveries:143})
 })
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message))
 const open=()=>page.getByRole('button',{name:/^Unpublish all$/i}).click()
 const dialog=page.getByRole('dialog',{name:'Unpublish all SOAs?'})
 const password=()=>dialog.getByLabel('Your current Admin password',{exact:true})
 const confirm=()=>dialog.getByRole('button',{name:/^Confirm unpublish all$/i})
 await page.goto('http://localhost:5173/admin/soa/batches/42')
 await page.getByRole('button',{name:/^Unpublish all$/i}).waitFor()
 await page.getByPlaceholder('e.g. 401 or owner name').fill('231')
 assert.equal(await page.locator('tbody tr').count(),1)
 await open();assert.match(await dialog.textContent(),/All 143 Statements/)
 assert.equal(await confirm().isDisabled(),true)
 await page.screenshot({path:`${output}/unpublish-desktop.png`,fullPage:true})
 await password().fill('cancelled-secret');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(calls,0)
 await open();assert.equal(await password().inputValue(),'')
 await password().fill('wrong-password');await confirm().click()
 await dialog.getByRole('alert').waitFor();assert.match(await dialog.getByRole('alert').textContent(),/password is incorrect/)
 assert.equal(await password().inputValue(),'');assert.equal(await confirm().isDisabled(),true);assert.equal(calls,1)
 assert.ok(bills.every(bill=>bill.publishedAt))
 mode='conflict';await password().fill('FixtureAdmin9!long');await confirm().click()
 await dialog.getByText(/Refresh the batch and try again/).waitFor();assert.equal(calls,2);assert.ok(bills.every(bill=>bill.publishedAt))
 mode='success';await password().fill('FixtureAdmin9!long');await confirm().click()
 await dialog.getByRole('button',{name:'Unpublishing...',exact:true}).waitFor()
 assert.equal(await dialog.getByRole('button',{name:'Cancel',exact:true}).isDisabled(),true)
 await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),true)
 release();await dialog.waitFor({state:'hidden'})
 assert.equal(calls,3);assert.ok(bills.every(bill=>!bill.publishedAt));assert.equal(await page.getByRole('button',{name:/^Unpublish all$/i}).count(),0)
 assert.equal(await page.getByRole('button',{name:/^Publish all remaining$/i}).isEnabled(),true)
 await page.getByText('0 published to Residents | 143 still hidden',{exact:true}).waitFor()
 assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('FixtureAdmin9!long')),false)
 console.log('PASS all-batch scope with filtered rows, required password, cancellation, wrong-password/409 errors, busy state and success refresh')
 bills=makeBills();bills[0].publishedAt=null;await page.reload()
 await page.getByText('142 published to Residents | 1 still hidden',{exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:/^Unpublish all$/i}).count(),0)
 bills=makeBills();await page.reload();await page.getByRole('button',{name:/^Unpublish all$/i}).waitFor()
 await page.setViewportSize({width:390,height:844});await open();await page.screenshot({path:`${output}/unpublish-mobile.png`,fullPage:true})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0&&bounds.width<=390&&bounds.height<=844)
 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>document.body.style.overflow),'')
 assert.deepEqual(errors,[]);console.log('PASS mobile dialog layout, Escape, focus/scroll cleanup and no browser errors. All requests mocked.')
 await context.close()
} finally { if(release)release();await browser.close() }
