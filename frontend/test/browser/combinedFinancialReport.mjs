// Read-only mocked report APIs. No real billing or payment records are changed.
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const { chromium }=await import(process.env.PLAYWRIGHT_MODULE||'playwright')
const output=fileURLToPath(new URL('../../../artifacts/combined-report/',import.meta.url));await mkdir(output,{recursive:true})
const fixture=JSON.parse(await readFile(`${output}/mock-report.json`,'utf8'))
const workbook=await readFile(`${output}/combined-billing-test.xlsx`)
const browser=await chromium.launch({channel:'chrome',headless:true})
const errors=[];let fail=false,hold=false,release,printCount=0
async function open(role,path){
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true})
 const user={id:role==='ADMIN'?1:3,role,fullName:'Report Tester',isActive:true,approvalStatus:'APPROVED'}
 await context.addInitScript(user=>{localStorage.setItem('condo_token','mock-only');localStorage.setItem('condo_user',JSON.stringify(user));window.print=()=>{window.__prints=(window.__prints||0)+1}},user)
 await context.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname
  assert.equal(req.method(),'GET','Report UI checks must be read-only')
  const respond=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
  if(path==='/api/auth/me')return respond({user})
  if(path==='/api/notifications')return respond({notifications:[],unreadCount:0})
  if(path==='/api/reports/financial/export'){
   assert.equal(url.searchParams.get('tab'),'combined');assert.equal(url.searchParams.get('month'),'2026-10')
   return route.fulfill({contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',headers:{'Content-Disposition':'attachment; filename="combined-billing-test.xlsx"'},body:workbook})
  }
  if(path==='/api/reports/financial'){
   if(hold)await new Promise(resolve=>{release=resolve})
   if(fail)return respond({message:'Report unavailable. Please retry.'},503)
   const report=structuredClone(fixture)
   const month=url.searchParams.get('month')||'2026-10';report.filters={mode:'MONTH',month,startDate:`${month}-01`,endDate:month.endsWith('-11')?`${month}-30`:`${month}-31`,label:month};report.combined.asOfDate=report.filters.endDate
   return respond(report)
  }
  throw new Error(`Unexpected API request ${path}`)
 })
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(`http://localhost:5173${path}`)
 await page.getByRole('tab',{name:'Overall Billing',exact:true}).click()
 await page.getByRole('table',{name:'Overall billing by unit',exact:true}).waitFor()
 await page.getByLabel('Select month',{exact:true}).fill('2026-10');await page.getByRole('button',{name:'View report',exact:true}).click()
 await page.getByRole('table',{name:'Overall billing by unit',exact:true}).waitFor()
 return{context,page}
}
try{
 let {context,page}=await open('ADMIN','/admin/reports')
 const table=page.getByRole('table',{name:'Overall billing by unit',exact:true})
 assert.equal(await table.locator('tbody tr').count(),143)
 for(const text of ['Paid','Partially Paid','Unpaid','No Charges','No SOA'])assert.ok(await table.getByText(text,{exact:true}).count()>0,text)
 assert.equal(await table.locator('tfoot').getByText('₱272.03',{exact:true}).count(),1)
 assert.equal(await table.locator('tfoot').getByText('₱162.03',{exact:true}).count(),1)
 assert.equal(await table.locator('tfoot').getByText('₱110.00',{exact:true}).count(),1)
 await page.screenshot({path:`${output}/combined-desktop.png`,fullPage:true})
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Export Excel',exact:true}).click()]);assert.match(download.suggestedFilename(),/combined.*2026-10-01\.xlsx/)
 await page.getByRole('button',{name:'Print / Save PDF',exact:true}).click();assert.equal(await page.evaluate(()=>window.__prints),1);printCount++
 await page.emulateMedia({media:'print'})
 const printReport=page.locator('.financial-report-print')
 assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor),'rgb(255, 255, 255)')
 assert.equal(await printReport.locator('[data-summary]').count(),0)
 assert.equal(await printReport.getByText(/SOAs starting|Paid amounts include/).count(),0)
 assert.equal(await printReport.locator('tbody tr').count(),143)
 const printStyle=await printReport.locator('tbody td').first().evaluate(el=>{const s=getComputedStyle(el);return {color:s.color,background:s.backgroundColor,font:s.fontFamily,weight:s.fontWeight,border:s.borderTopColor}})
 assert.equal(printStyle.color,'rgb(0, 0, 0)');assert.equal(printStyle.background,'rgb(255, 255, 255)');assert.match(printStyle.font,/Arial/);assert.equal(printStyle.weight,'400');assert.equal(printStyle.border,'rgb(0, 0, 0)')
 await page.pdf({path:`${output}/combined-billing-143-units.pdf`,preferCSSPageSize:true,printBackground:true})
 await page.emulateMedia({media:'screen'})
 console.log('PASS all 143 unit rows, paid/unpaid statuses, totals, Excel download and PDF print action')

 hold=true;fail=true
 await page.getByLabel('Select month',{exact:true}).fill('2026-11');await page.getByRole('button',{name:'View report',exact:true}).click()
 await page.getByText('Loading financial records...',{exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:'Export Excel',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Print / Save PDF',exact:true}).isDisabled(),true)
 release();hold=false
 await page.getByText('Report unavailable. Please retry.',{exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:'Export Excel',exact:true}).isDisabled(),true);assert.equal(await page.locator('.financial-report-print').count(),0)
 fail=false;await page.getByRole('button',{name:'View report',exact:true}).click();await page.getByRole('table',{name:'Overall billing by unit',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Export Excel',exact:true}).isEnabled(),true)
 console.log('PASS exports disabled during loading/failure and restored after a successful retry')
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:`${output}/combined-mobile.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 const scroll=page.locator('.financial-report-table-scroll').filter({has:page.locator('.combined-billing-table')}).first();assert.equal(await scroll.evaluate(el=>el.scrollWidth>el.clientWidth),true)
 await context.close()
 ;({context,page}=await open('COLLECTOR','/collector/reports'))
 assert.equal(await page.getByRole('table',{name:'Overall billing by unit',exact:true}).locator('tbody tr').count(),143);assert.equal(await page.getByRole('button',{name:'Export Excel',exact:true}).isEnabled(),true)
 await context.close();assert.equal(printCount,1);assert.deepEqual(errors,[]);console.log('PASS responsive table scrolling and Billing Associate access. All API calls were mocked.')
}finally{await browser.close()}
