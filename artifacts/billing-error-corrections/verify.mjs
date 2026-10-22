import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'file:///C:/Users/yaoim/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const reports=[
  {id:11,billId:701,unitNumber:'239',status:'OPEN',category:'ASSOCIATION_DUES',description:'Association balance needs correction.'},
  {id:12,billId:701,unitNumber:'239',status:'OPEN',category:'PAYMENT_OR',description:'Invoice needs review.'},
  {id:13,billId:702,unitNumber:'240',status:'RESOLVED',category:'OTHER',description:'Previously resolved issue.',resolutionNote:'Confirmed the statement details.'},
  {id:14,billId:703,unitNumber:'241',status:'OPEN',category:'WATER_CHARGE',description:'Pending-payment bill review.'},
  {id:15,billId:704,unitNumber:'242',status:'OPEN',category:'METER_READING',description:'Unpaid bill reading review.'},
].map(row=>({...row,reportedByName:'Test Resident',periodStart:'2026-09-05'}));
const makeBill=(id,unitNumber,approvedAmount=0,hasPendingPayment=false)=>({
  id,unitId:id-700,unitNumber,floor:'2',billingPeriodId:39,status:id===702?'CLOSED':'FORWARDED',
  payerName:'Test Resident',payerEmail:'resident@example.invalid',periodStart:'2026-09-05',periodEnd:'2026-10-05',
  statementDate:'2026-10-05',dueDate:'2026-10-19',publishedAt:'2026-10-05T00:00:00Z',
  previousReading:1000,currentReading:1010,consumption:10,totalAmount:2230,approvedAmount,
  remainingBalance:2230-approvedAmount,latePenaltyAmount:0,hasPendingPayment,soaRevision:1,paymentNote:'',
  charges:[{id:id*10,chargeType:'WATER',description:'Water charge',quantity:10,rateApplied:23,amount:230},
    {id:id*10+1,chargeType:'ASSOCIATION_DUES',description:'Association dues',quantity:20,rateApplied:100,amount:2000}],
});
const bills=new Map([[701,makeBill(701,'239',100)],[702,makeBill(702,'240',100)],
  [703,makeBill(703,'241',0,true)],[704,makeBill(704,'242')]]);
const corrections=[],resolutions=[],errors=[];
const browser=await chromium.launch({channel:'chrome',headless:true});
async function setup(role) {
  const context=await browser.newContext({viewport:{width:1366,height:900}});
  const user={id:1,role,fullName:'Billing Preview',email:'preview@example.invalid'};
  await context.addInitScript(user=>{localStorage.setItem('condo_token','billing-preview');localStorage.setItem('condo_user',JSON.stringify(user));},user);
  await context.route('**/api/**',async route=>{
    const url=new URL(route.request().url()),path=url.pathname,method=route.request().method();
    let json={};
    if(path==='/api/auth/me')json={user};
    else if(path==='/api/notifications')json={notifications:[],unreadCount:0};
    else if(path==='/api/billing-errors') {
      const status=url.searchParams.get('status');json={reports:reports.filter(row=>status==='ALL'||row.status===status)};
    } else if(/^\/api\/billing-errors\/\d+\/resolve$/.test(path)) {
      const id=Number(path.split('/')[3]),body=route.request().postDataJSON();
      assert.equal(method,'PATCH');assert.equal(role,'COLLECTOR');
      const report=reports.find(row=>row.id===id);assert.equal(report.status,'OPEN');
      resolutions.push({id,body});report.status='RESOLVED';report.resolutionNote=body.resolutionNote;
      json={message:'Billing error report resolved.'};
    } else if(/^\/api\/bills\/\d+$/.test(path)) {
      const id=Number(path.split('/').at(-1));let bill=bills.get(id);
      assert.ok(bill,'Requested the correct associated bill');
      if(method==='PATCH') {
        const body=route.request().postDataJSON();
        assert.equal(role,'COLLECTOR');assert.equal(body.billingErrorReportId,11);
        assert.equal(reports.find(row=>row.id===body.billingErrorReportId).billId,id);
        const approvedBefore=bill.approvedAmount;
        corrections.push({id,body});
        const charges=bill.charges.map(charge=>{
          const updated=body.charges.find(row=>row.id===charge.id),quantity=updated.quantity??charge.quantity;
          return {...charge,...updated,quantity,amount:quantity*updated.rateApplied};
        });
        const totalAmount=charges.reduce((sum,row)=>sum+row.amount,0);
        bill={...bill,charges,totalAmount,remainingBalance:totalAmount-approvedBefore,soaRevision:bill.soaRevision+1};bills.set(id,bill);
        assert.equal(bill.approvedAmount,approvedBefore);
        json={message:'SOA updated.',bill};
      } else json={bill};
    } else if(path.startsWith('/api/soa-template/assets/')) {
      await route.fulfill({status:404,json:{message:'No custom asset'}});return;
    } else throw new Error('Unexpected API request '+method+' '+path);
    await route.fulfill({json});
  });
  const page=await context.newPage();page.setDefaultTimeout(15000);
  page.on('pageerror',error=>errors.push(error.message));
  return {context,page};
}
try {
  const {context,page}=await setup('COLLECTOR');
  await page.goto('http://127.0.0.1:5173/collector/billing-errors');
  await page.getByRole('link',{name:'Open / Fix SOA',exact:true}).first().waitFor();
  assert.equal(await page.getByRole('link',{name:'Open / Fix SOA',exact:true}).count(),3);
  assert.equal(await page.getByRole('link',{name:'Fix invoice',exact:true}).count(),1);
  const card=page.locator('article').filter({hasText:'Association balance needs correction.'});
  assert.equal(await card.getByRole('link',{name:'Open / Fix SOA',exact:true}).getAttribute('href'),'/collector/bills/701?from=billing-errors&reportId=11');
  assert.equal(await card.getByRole('link',{name:'Open / Fix SOA',exact:true}).evaluate(element=>getComputedStyle(element).color),'rgb(255, 255, 255)');
  await page.screenshot({path:'artifacts/billing-error-corrections/reports-desktop.png'});
  await card.getByRole('link',{name:'Open / Fix SOA',exact:true}).click();
  await page.getByRole('button',{name:'Correct reported SOA',exact:true}).waitFor();
  await page.getByRole('button',{name:'Correct reported SOA',exact:true}).click();
  await page.getByRole('spinbutton',{name:'Rate',exact:true}).nth(1).fill('90');
  await page.getByLabel('Reason for correction',{exact:true}).fill('Corrected association dues rate after resident report.');
  await page.screenshot({path:'artifacts/billing-error-corrections/correction-editor.png'});
  await page.getByRole('button',{name:'Save corrected SOA',exact:true}).click();
  await page.getByText('SOA updated.',{exact:true}).waitFor();
  assert.equal(corrections.length,1);assert.equal(corrections[0].body.billingErrorReportId,11);
  assert.equal(corrections[0].body.charges[1].rateApplied,90);
  assert.equal(bills.get(701).approvedAmount,100);
  assert.equal(reports.find(row=>row.id===11).status,'OPEN','Saving must not silently resolve the report');
  await page.getByRole('link',{name:'Back to Billing Errors',exact:true}).click();
  await page.locator('article').filter({hasText:'Association balance needs correction.'}).getByRole('button',{name:'Resolve report',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('textbox',{name:'Resolution note',exact:true}).fill('Association dues rate corrected and the updated SOA checked.');
  await dialog.getByRole('button',{name:'Resolve report',exact:true}).click();
  await page.getByText('Billing error report resolved.',{exact:true}).waitFor();
  assert.equal(resolutions.length,1);
  assert.equal(await page.locator('article').filter({hasText:'Association balance needs correction.'}).count(),0);
  await page.getByRole('button',{name:'Resolved',exact:true}).click();
  const resolved=page.locator('article').filter({hasText:'Association balance needs correction.'});
  await resolved.getByRole('link',{name:'View SOA',exact:true}).waitFor();
  assert.equal(await resolved.getByRole('link').getAttribute('href'),'/collector/bills/701?from=billing-errors');
  assert.equal(await page.getByRole('link',{name:'Open / Fix SOA',exact:true}).count(),0);
  await resolved.getByRole('link',{name:'View SOA',exact:true}).click();
  await page.getByText('This SOA has an approved payment, so billing amounts are protected.',{exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Correct reported SOA',exact:true}).count(),0);
  await page.getByRole('link',{name:'Back to Billing Errors',exact:true}).click();
  await page.getByRole('link',{name:'Open / Fix SOA',exact:true}).first().waitFor();
  const pending=page.locator('article').filter({hasText:'Pending-payment bill review.'});
  await pending.getByRole('link',{name:'Open / Fix SOA',exact:true}).click();
  await page.getByRole('button',{name:'Correct reported SOA',exact:true}).waitFor();
  assert.ok(page.url().includes('reportId=14'));
  await page.getByRole('button',{name:'Correct reported SOA',exact:true}).click();
  await page.getByRole('button',{name:'Save corrected SOA',exact:true}).waitFor();
  await page.getByRole('button',{name:'Cancel correction',exact:true}).click();
  await page.getByRole('link',{name:'Back to Billing Errors',exact:true}).click();
  for(const width of [390,320]) {
    await page.setViewportSize({width,height:844});await page.mouse.move(0,0);
    await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth,{},{timeout:10000});
    await page.screenshot({path:`artifacts/billing-error-corrections/reports-${width}.png`});
  }
  await context.close();
  const admin=await setup('ADMIN');
  await admin.page.goto('http://127.0.0.1:5173/admin/billing-errors');
  await admin.page.getByText('Invoice needs review.',{exact:true}).waitFor();
  assert.equal(await admin.page.getByRole('link',{name:'View SOA',exact:true}).count(),0);
  assert.equal(await admin.page.getByRole('button',{name:'Resolve report',exact:true}).count(),0);
  assert.equal(await admin.page.getByRole('link',{name:'Open / Fix SOA',exact:true}).count(),0);
  assert.equal(await admin.page.getByRole('link',{name:'Fix invoice',exact:true}).count(),0);
  await admin.context.close();
  assert.deepEqual(errors,[]);
  const result={verifiedAt:new Date().toISOString(),reportOpensCorrectBill:true,reportIdIncludedInCorrection:true,
    paidBillCorrection:true,pendingBillCorrection:true,resolutionRequiresNote:true,saveDoesNotAutoResolve:true,
    resolvedReportsViewable:true,resolvedReportsDoNotBypassPaymentProtection:true,adminViewOnlyReportActions:true,
    mobileWidths:[390,320],browserErrors:errors,mockedRequestsOnly:true};
  await writeFile('artifacts/billing-error-corrections/result.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally {await browser.close();}
