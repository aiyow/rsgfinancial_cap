import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'file:///C:/Users/yaoim/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const payments=[
  {id:301,unitId:10,unitNumber:'239',targetBillId:1457,paymentPurpose:'COMBINED',verifiedAmount:300,appliedAmount:300,unappliedAmount:0,
    allocations:[{chargeType:'WATER',allocatedAmount:100,appliedAmount:100,invoiceNumber:'BAD-WATER'},
      {chargeType:'ASSOCIATION_DUES',allocatedAmount:200,appliedAmount:200,invoiceNumber:'BAD-DUES'}]},
  {id:302,unitId:20,unitNumber:'999',targetBillId:1460,paymentPurpose:'WATER',verifiedAmount:50,appliedAmount:50,unappliedAmount:0,
    allocations:[{chargeType:'WATER',allocatedAmount:50,appliedAmount:50,invoiceNumber:'OTHER-UNIT'}]},
  {id:303,unitId:10,unitNumber:'239',targetBillId:null,paymentPurpose:'WATER',verifiedAmount:50,appliedAmount:0,unappliedAmount:50,
    allocations:[{chargeType:'WATER',allocatedAmount:50,appliedAmount:0,invoiceNumber:null}]},
].map(payment=>({...payment,reviewStatus:'APPROVED',paymentMethod:'CASH',entryType:'MANUAL',paymentStatus:payment.targetBillId?'PARTIAL':'ADVANCE',
  verifiedReferenceNo:`TX-${payment.id}`,residentName:payment.unitId===10?'Reported Resident':'Other Resident',submittedByName:'Admin',
  verifiedPaymentDate:'2026-10-20',submittedAt:`2026-10-20T10:00:0${payment.id-300}Z`}));
const reports=[{id:9,billId:1456,unitNumber:'239',description:'Invoice is incorrect.'},
  {id:10,billId:1457,unitNumber:'239',description:'Wrong water and dues invoice.'},
  {id:11,billId:1458,unitNumber:'240',description:'Pending invoice report.'}]
  .map(report=>({...report,category:'PAYMENT_OR',status:'OPEN',periodStart:'2026-09-05',reportedByName:'Test Resident'}));
const makeBill=(id,unitId,unitNumber,approvedAmount=0,hasPendingPayment=false)=>({id,unitId,unitNumber,floor:'2',
  billingPeriodId:39,status:'FORWARDED',payerName:'Test Resident',payerEmail:'resident@example.invalid',
  periodStart:'2026-09-05',periodEnd:'2026-10-05',statementDate:'2026-10-05',dueDate:'2026-10-19',
  previousReading:1000,currentReading:1010,consumption:10,totalAmount:500,approvedAmount,remainingBalance:500-approvedAmount,
  hasPendingPayment,latePenaltyAmount:0,publishedAt:'2026-10-05T00:00:00Z',
  charges:[{id:1,chargeType:'WATER',description:'Water',quantity:10,rateApplied:23,amount:230},
    {id:2,chargeType:'ASSOCIATION_DUES',description:'Association dues',quantity:10,rateApplied:27,amount:270}]});
const bills=[makeBill(1456,10,'239'),makeBill(1457,10,'239',300),makeBill(1458,11,'240',0,true)];
function billWithInvoices(id) {
  const bill=bills.find(row=>row.id===id);
  const chargePayments=Object.fromEntries(['WATER','ASSOCIATION_DUES'].map(chargeType=>{
    const payment=id===1457?payments.find(row=>row.id===301):null;
    const allocation=payment?.allocations.find(row=>row.chargeType===chargeType);
    return [chargeType,{...allocation,approvedAmount:allocation?.appliedAmount||0,
      invoiceReferences:allocation?.invoiceNumber?[allocation.invoiceNumber]:[],
      payments:allocation?[{paymentId:payment.id,chargeType,invoiceNumber:allocation.invoiceNumber}]:[]}];
  }));
  return {...bill,chargePayments};
}
const financialState=()=>JSON.stringify({payments:payments.map(payment=>({id:payment.id,unitId:payment.unitId,
  verifiedAmount:payment.verifiedAmount,appliedAmount:payment.appliedAmount,unappliedAmount:payment.unappliedAmount,
  reference:payment.verifiedReferenceNo,allocations:payment.allocations.map(({invoiceNumber,...row})=>row)})),bills});
const before=financialState(),errors=[],patches=[];
let failNextSave=true;
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const context=await browser.newContext({viewport:{width:1366,height:900}});
  const user={id:1,role:'COLLECTOR',fullName:'Billing Preview',email:'preview@example.invalid'};
  await context.addInitScript(user=>{localStorage.setItem('condo_token','invoice-preview');localStorage.setItem('condo_user',JSON.stringify(user));},user);
  await context.route('**/api/**',async route=>{
    const url=new URL(route.request().url()),path=url.pathname,method=route.request().method();
    let json={};
    if(path==='/api/auth/me')json={user};
    else if(path==='/api/notifications')json={notifications:[],unreadCount:0};
    else if(path==='/api/billing-errors')json={reports};
    else if(/^\/api\/bills\/\d+$/.test(path)) {
      assert.equal(method,'GET','Invoice corrections must not change bill amounts');
      json={bill:billWithInvoices(Number(path.split('/').at(-1)))};
    } else if(path==='/api/payments') {assert.equal(url.searchParams.get('status'),'APPROVED');json={payments};}
    else if(/^\/api\/payments\/\d+\/invoice-references$/.test(path)) {
      assert.equal(method,'PATCH');const id=Number(path.split('/')[3]),body=route.request().postDataJSON();
      assert.deepEqual(Object.keys(body),['invoices']);
      const payment=payments.find(row=>row.id===id);assert.equal(payment.reviewStatus,'APPROVED');
      if(failNextSave) {failNextSave=false;await route.fulfill({status:503,json:{message:'Temporary invoice save error.'}});return;}
      for(const invoice of body.invoices) payment.allocations.find(row=>row.chargeType===invoice.chargeType).invoiceNumber=invoice.invoiceNumber;
      patches.push({id,body});json={message:'Issued invoice references saved.',payment};
    } else if(/^\/api\/payments\/\d+$/.test(path))json={payment:payments.find(row=>row.id===Number(path.split('/').at(-1)))};
    else if(path.startsWith('/api/soa-template/assets/')){await route.fulfill({status:404,json:{message:'No custom asset'}});return;}
    else throw new Error('Unexpected request '+method+' '+path);
    await route.fulfill({json});
  });
  const page=await context.newPage();page.setDefaultTimeout(15000);
  page.on('pageerror',error=>errors.push(error.message));
  const base='http://127.0.0.1:5173';
  await page.goto(base+'/collector/billing-errors');
  const zeroReport=page.locator('article').filter({hasText:'Invoice is incorrect.'});
  await zeroReport.getByRole('link',{name:'Fix invoice',exact:true}).waitFor();
  assert.equal(await zeroReport.getByRole('link',{name:'Fix invoice',exact:true}).getAttribute('href'),'/collector/bills/1456?from=billing-errors&reportId=9&section=invoices');
  await page.screenshot({path:'artifacts/invoice-report-fix/report-action.png'});
  await zeroReport.getByRole('link',{name:'Fix invoice',exact:true}).click();
  let region=page.getByRole('region',{name:'SOA invoice entry',exact:true});
  await region.getByText('No approved payment is applied to this SOA, so there is no linked payment invoice to edit yet.',{exact:true}).waitFor();
  assert.equal(await region.getByRole('textbox').count(),0);
  await page.getByRole('button',{name:'Fix invoice',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.activeElement.id),'soa-invoice-numbers');
  await region.screenshot({path:'artifacts/invoice-report-fix/no-approved-payment.png'});
  await region.getByRole('link',{name:'Review unit payments',exact:true}).click();
  await page.getByRole('button',{name:/View payment details 303 /}).waitFor();
  assert.equal(await page.getByRole('button',{name:/View payment details 302 /}).count(),0);
  assert.equal(await page.getByRole('link',{name:'Back to reported SOA',exact:true}).getAttribute('href'),'/collector/bills/1456?from=billing-errors&reportId=9&section=invoices');
  await page.getByRole('button',{name:/View payment details 303 /}).click();
  let dialog=page.getByRole('dialog',{name:'Payment details',exact:true});
  await dialog.getByRole('textbox',{name:'Water invoice number',exact:true}).fill('ADVANCE-239');
  await dialog.getByRole('button',{name:'Save Water Invoice',exact:true}).click();
  await dialog.getByText('Temporary invoice save error.',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'Save Water Invoice',exact:true}).click();
  await dialog.getByText('Issued invoice references saved.',{exact:true}).waitFor();
  assert.equal(payments.find(row=>row.id===303).allocations[0].invoiceNumber,'ADVANCE-239');
  await dialog.screenshot({path:'artifacts/invoice-report-fix/payment-invoice-editor.png'});
  await dialog.getByRole('button',{name:'Close payment details',exact:true}).click();
  await page.getByRole('link',{name:'Back to reported SOA',exact:true}).click();
  await page.getByRole('link',{name:'Back to Billing Errors',exact:true}).click();
  await page.locator('article').filter({hasText:'Wrong water and dues invoice.'}).getByRole('link',{name:'Fix invoice',exact:true}).click();
  region=page.getByRole('region',{name:'SOA invoice entry',exact:true});
  await region.getByRole('textbox',{name:'Water invoice number',exact:true}).waitFor();
  assert.equal(await region.getByRole('textbox',{name:'Water invoice number',exact:true}).inputValue(),'BAD-WATER');
  assert.equal(await region.getByRole('textbox',{name:'Association Dues invoice number',exact:true}).inputValue(),'BAD-DUES');
  await region.getByRole('textbox',{name:'Water invoice number',exact:true}).fill('WATER-239-FIXED');
  await region.getByRole('button',{name:'Save Water Invoice',exact:true}).click();
  await page.locator('.soa-sheet').getByText('WATER-239-FIXED',{exact:true}).waitFor();
  assert.equal(payments[0].allocations[1].invoiceNumber,'BAD-DUES');
  await region.getByRole('textbox',{name:'Association Dues invoice number',exact:true}).fill('DUES-239-FIXED');
  await region.getByRole('button',{name:'Save Association Dues Invoice',exact:true}).click();
  await page.locator('.soa-sheet').getByText('DUES-239-FIXED',{exact:true}).waitFor();
  await region.screenshot({path:'artifacts/invoice-report-fix/linked-invoice-editor.png'});
  await region.getByRole('textbox',{name:'Association Dues invoice number',exact:true}).fill('');
  await region.getByRole('button',{name:'Save Association Dues Invoice',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.soa-sheet').textContent.includes('DUES-239-FIXED'));
  assert.equal(payments[0].allocations[0].invoiceNumber,'WATER-239-FIXED');
  assert.equal(payments[0].allocations[1].invoiceNumber,null);
  for(const width of [390,320]) {
    await page.setViewportSize({width,height:844});await page.mouse.move(0,0);
    assert(await region.evaluate(el=>el.scrollWidth<=el.clientWidth));
    await region.screenshot({path:`artifacts/invoice-report-fix/linked-editor-${width}.png`});
  }
  await page.setViewportSize({width:1366,height:900});
  await page.goto(base+'/collector/bills/1458?from=billing-errors&reportId=11&section=invoices');
  region=page.getByRole('region',{name:'SOA invoice entry',exact:true});
  await region.getByText('This SOA has a payment awaiting Admin approval. Its invoice can be added or corrected after approval.',{exact:true}).waitFor();
  assert.equal(await region.getByRole('textbox').count(),0);
  await region.getByRole('link',{name:'Review unit payments',exact:true}).click();
  await page.getByText('No payments found',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:/View payment details /}).count(),0);
  await page.goto(base+'/collector/bills/1457');
  await page.getByRole('button',{name:'Invoice Numbers',exact:true}).waitFor();
  region=page.getByRole('region',{name:'SOA invoice entry',exact:true});
  assert.equal(await region.getByRole('textbox').count(),0,'Ordinary bill editors stay collapsed until opened');
  await region.getByText('Edit Water Invoice',{exact:true}).click();
  await region.getByRole('textbox',{name:'Water invoice number',exact:true}).waitFor();
  assert.equal(financialState(),before,'Invoice edits must preserve all money and transaction references');
  assert(reports.every(report=>report.status==='OPEN'),'Invoice editing must not auto-resolve reports');
  assert.deepEqual(errors,[]);
  const result={verifiedAt:new Date().toISOString(),directInvoiceReportLink:true,zeroPaymentGuidance:true,
    unitScopedApprovedPayments:true,paymentDialogInvoiceEditing:true,linkedSoaInvoiceRefresh:true,bothChargeTypes:true,
    failedSaveRetry:true,clearInvoice:true,pendingApprovalGuidance:true,emptyPaymentList:true,
    normalInvoiceEditorsPreserved:true,amountsAndReferencesUnchanged:true,reportStaysOpen:true,mobileWidths:[390,320],
    successfulInvoiceUpdates:patches.length,browserErrors:errors,mockedRequestsOnly:true};
  await writeFile('artifacts/invoice-report-fix/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  await context.close();
} finally {await browser.close();}
