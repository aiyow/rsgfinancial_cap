// Mocked payment APIs only: no real payments or approvals are changed.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const { chromium }=await import(process.env.PLAYWRIGHT_MODULE||'playwright')
const output=fileURLToPath(new URL('../../../artifacts/payment-or/',import.meta.url));await mkdir(output,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true})
const errors=[]
const base={entryType:'MANUAL',paymentMethod:'CASH',paymentPurpose:'COMBINED',submittedAt:'2026-10-25T06:00:00Z',reviewedAt:'2026-10-25T07:00:00Z',verifiedPaymentDate:'2026-10-25',verifiedAmount:30,appliedAmount:30,unappliedAmount:0,unitAdvanceBalance:0,remainingBalance:0,billTotal:30,paymentStatus:'PAID',reviewStatus:'APPROVED',submittedByName:'Test Admin',residentName:'Test Resident',allocations:[{chargeType:'WATER',allocatedAmount:10,appliedAmount:10,invoiceNumber:'WATER-INV-1'},{chargeType:'ASSOCIATION_DUES',allocatedAmount:20,appliedAmount:20,invoiceNumber:'DUES-INV-1'}]}
const payments=[{...base,id:1,unitId:10,unitNumber:'231',officialReceiptNo:'REF-0000001'},{...base,id:2,unitId:20,unitNumber:'232',residentName:'Other Resident',officialReceiptNo:'REF-0000002'},{...base,id:3,unitId:10,unitNumber:'231',entryType:'RECEIPT_UPLOAD',reviewStatus:'PENDING',officialReceiptNo:null,verifiedAmount:null,ocrAmount:12,allocations:[]}]
async function open(role,path,viewport={width:1366,height:900}){
 const context=await browser.newContext({viewport})
 const user={id:role==='ADMIN'?501:role==='COLLECTOR'?503:502,role,fullName:'Test '+role,email:'test@example.invalid',isActive:true,approvalStatus:'APPROVED'}
 await context.addInitScript(user=>{localStorage.setItem('condo_token','mock-only');localStorage.setItem('condo_user',JSON.stringify(user))},user)
 await context.route('**/api/**',route=>{
  const req=route.request(),path=new URL(req.url()).pathname
  assert.equal(req.method(),'GET','Payment display tests must not mutate any API')
  let data
  if(path==='/api/auth/me')data={user}
  else if(path==='/api/notifications')data={notifications:[],unreadCount:0}
  else if(path==='/api/payments')data={payments:role==='ADMIN'?payments:role==='COLLECTOR'?payments.filter(p=>p.reviewStatus==='APPROVED'):payments.filter(p=>p.unitId===10)}
  else if(/^\/api\/payments\/\d+$/.test(path))data={payment:payments.find(p=>String(p.id)===path.split('/').at(-1))}
  else if(path==='/api/bills')data={bills:[]}
  else if(path==='/api/units')data={units:[]}
  else if(path==='/api/payments/credits')data={credits:[]}
  else throw new Error(`Unexpected mocked request: ${path}`)
  return route.fulfill({contentType:'application/json',body:JSON.stringify(data)})
 })
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(`http://localhost:5173${path}`)
 return {context,page}
}
try{
 let {context,page}=await open('ADMIN','/admin/payments')
 await page.getByRole('columnheader',{name:'Reference number',exact:true}).waitFor()
 const table=page.getByRole('table');assert.equal(await table.getByRole('cell',{name:'REF-0000001',exact:true}).count(),1);assert.equal(await table.getByRole('cell',{name:'REF-0000002',exact:true}).count(),1)
 const pending=table.getByRole('row').filter({hasText:'Pending'});assert.equal(await pending.getByRole('cell',{name:'—',exact:true}).count(),1)
 await page.screenshot({path:`${output}/admin-queue-desktop.png`})
 await page.getByRole('searchbox',{name:'Search payments'}).fill('ref-0000001');assert.equal(await table.getByRole('row').count(),2)
 await table.getByRole('link',{name:/^View payment details 1 /}).click();await page.getByText('REF-0000001',{exact:true}).waitFor();await page.reload();await page.getByText('REF-0000001',{exact:true}).waitFor()
 await page.screenshot({path:`${output}/admin-details.png`});await context.close()
 console.log('PASS unique REF column, REF search, pending placeholder, details and refresh')

 ;({context,page}=await open('ADMIN','/admin/payments',{width:390,height:844}))
 await page.getByText('Reference number: REF-0000001',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 await page.screenshot({path:`${output}/admin-queue-mobile.png`,fullPage:true});await context.close()
 ;({context,page}=await open('COLLECTOR','/collector/payments'))
 await page.getByRole('cell',{name:'REF-0000001',exact:true}).waitFor()
 await page.getByRole('row').filter({hasText:'REF-0000001'}).getByRole('button',{name:/^View payment details 1 /}).click()
 await page.getByRole('dialog').getByText('REF-0000001',{exact:true}).waitFor();await page.screenshot({path:`${output}/associate-details.png`});await context.close()
 ;({context,page}=await open('RESIDENT','/resident/payments',{width:390,height:844}))
 await page.getByText('Reference number: REF-0000001',{exact:true}).waitFor();assert.equal(await page.getByText('Reference number: REF-0000002',{exact:true}).count(),0)
 await page.screenshot({path:`${output}/resident-history-mobile.png`,fullPage:true});await context.close()
 assert.deepEqual(errors,[]);console.log('PASS mobile queue, associate details and resident history. All requests were mocked and read-only.')
}finally{await browser.close()}
