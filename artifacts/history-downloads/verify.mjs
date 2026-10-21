import { chromium } from 'file:///C:/Users/yaoim/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { exportAnalyticsWorkbook, workbookMimeType } from '../../backend/services/analyticsWorkbook.js';
const buffer=await exportAnalyticsWorkbook('2026-11',[
  {unitNumber:'101',previousReading:100,currentReading:110,consumption:10,waterRate:23,waterCharge:230,validationStatus:'VALID'},
  {unitNumber:'102',previousReading:200,currentReading:200,consumption:0,waterRate:23,waterCharge:0,validationStatus:'VALID'},
]);
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const user={id:1,role:'COLLECTOR',fullName:'Test Associate',email:'collector@example.invalid'};
  let imports=Array.from({length:8},(_,index)=>({periodMonth:`2026-${String(index+1).padStart(2,'0')}`,readingCount:142,flaggedCount:0,forecastForMonth:`2026-${String(index+2).padStart(2,'0')}-01`,readyForecastCount:index<4?0:139,originalFilename:null}));
  let failDownload=false,confirmedMultipart=false;
  const context=await browser.newContext({acceptDownloads:true,viewport:{width:1366,height:950}});
  await context.addInitScript(user=>{localStorage.setItem('condo_token','history-download-preview');localStorage.setItem('condo_user',JSON.stringify(user));},user);
  await context.route('**/api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname,method=request.method();
    let json={};
    if(path==='/api/auth/me') json={user};
    if(path==='/api/notifications') json={notifications:[],unreadCount:0};
    if(path==='/api/analytics/imports'&&method==='GET') json={imports};
    if(path.endsWith('/workbook')) {
      assert.equal(request.headers().authorization,'Bearer history-download-preview');
      if(failDownload) {await route.fulfill({status:503,json:{message:'Download temporarily unavailable.'}});return;}
      await route.fulfill({contentType:workbookMimeType,body:buffer});return;
    }
    if(path==='/api/analytics/imports/preview') {
      assert(request.headers()['content-type'].startsWith('multipart/form-data'));
      json={valid:true,periodMonth:'2026-11',waterRate:23,usesExistingLiveBilling:false,summary:{rowCount:2,unitCount:2,errorCount:0,warningCount:0},errors:[],warnings:[],rows:[
        {rowNumber:2,unitId:1,unitNumber:'101',previousReading:100,currentReading:110,consumption:10,waterCharge:230,errors:[],warnings:[]},
        {rowNumber:3,unitId:2,unitNumber:'102',previousReading:200,currentReading:200,consumption:0,waterCharge:0,errors:[],warnings:[]},
      ]};
    }
    if(path==='/api/analytics/imports'&&method==='POST') {
      assert(request.headers()['content-type'].startsWith('multipart/form-data'));
      assert(request.postDataBuffer().includes(buffer),'Confirmation must include the original workbook bytes');
      confirmedMultipart=true;
      imports=[...imports,{periodMonth:'2026-11',readingCount:2,flaggedCount:0,readyForecastCount:0,originalFilename:'Future history.xlsx'}];
      json={message:'Imported readings and retained the original workbook.'};
    }
    await route.fulfill({json});
  });
  const page=await context.newPage();page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://localhost:5173/collector/history-import');
  const panel=page.getByRole('heading',{name:'Imported analytics months',exact:true}).locator('..');
  const august=panel.getByRole('button',{name:'Download Excel for August 2026',exact:true});await august.waitFor();
  assert.equal(await panel.getByRole('button',{name:/Download Excel for/}).count(),8);
  await panel.getByText(/Forwarded billing months are included in Water Analytics automatically/).waitFor();
  async function downloadFrom(button,filename) {
    const pending=page.waitForEvent('download');await button.click();const download=await pending;
    assert.equal(download.suggestedFilename(),filename);
    const stream=await download.createReadStream(),chunks=[];for await(const chunk of stream) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks),buffer);
  }
  await downloadFrom(august,'water-history-2026-08.xlsx');
  await panel.screenshot({path:'artifacts/history-downloads/download-buttons.png'});
  failDownload=true;await august.click();await page.getByText('Download temporarily unavailable.',{exact:true}).waitFor();
  failDownload=false;await downloadFrom(august,'water-history-2026-08.xlsx');
  await page.locator('input[type="month"]').fill('2026-11');
  await page.locator('input[type="file"]').setInputFiles({name:'Future history.xlsx',mimeType:workbookMimeType,buffer});
  await page.getByRole('button',{name:'Preview',exact:true}).click();
  await page.getByRole('button',{name:'Confirm import',exact:true}).click();
  const future=panel.getByRole('button',{name:'Download Excel for November 2026',exact:true});await future.waitFor();
  assert(confirmedMultipart);
  await downloadFrom(future,'Future history.xlsx');
  await page.setViewportSize({width:390,height:900});
  assert(await panel.evaluate(element=>element.getBoundingClientRect().right<=document.documentElement.clientWidth),'The table should scroll within its panel on mobile');
  assert.deepEqual(errors,[]);
  console.log('PASS: per-month downloads, auth header, filenames, Excel bytes, download errors/retry, original file confirmation, and mobile table containment.');
} finally {await browser.close();}
