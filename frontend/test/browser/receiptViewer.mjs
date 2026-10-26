// Receipt images and all API responses are fabricated. No payment is changed.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const output=fileURLToPath(new URL('../../../artifacts/receipt-viewer/',import.meta.url));await mkdir(output,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true})
let receipt
const errors=[]
async function makeImage(page,width,height) {
 const data=await page.evaluate(({width,height})=>{
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const c=canvas.getContext('2d');
  c.fillStyle='#fff';c.fillRect(0,0,width,height);c.lineWidth=3;c.strokeStyle='#b0b0b0';
  for(let x=0;x<width;x+=100){c.beginPath();c.moveTo(x,0);c.lineTo(x,height);c.stroke()}
  for(let y=0;y<height;y+=100){c.beginPath();c.moveTo(0,y);c.lineTo(width,y);c.stroke()}
  for(const [x,y,color,label] of [[0,0,'red','TOP LEFT'],[width-100,0,'blue','TOP RIGHT'],[0,height-100,'green','BOTTOM LEFT'],[width-100,height-100,'orange','BOTTOM RIGHT']]){c.fillStyle=color;c.fillRect(x,y,100,100);c.fillStyle='#000';c.font='12px Arial';c.fillText(label,x+5,y+55)}
  return canvas.toDataURL('image/png').split(',')[1]
 },{width,height});return Buffer.from(data,'base64')
}
async function open(mobile=false) {
 const context=await browser.newContext(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:1366,height:1000},acceptDownloads:true})
 const user={id:1,role:'ADMIN',fullName:'Viewer Tester',isActive:true,approvalStatus:'APPROVED'}
 const payment={id:171,unitId:10,unitNumber:'237',entryType:'RECEIPT_UPLOAD',receiptMimeType:'image/png',paymentPurpose:'COMBINED',reviewStatus:'APPROVED',submittedByName:'Fixture Resident',submittedAt:'2026-10-24T07:00:00Z',reviewedAt:'2026-10-24T08:00:00Z',officialReceiptNo:'OR-0000000171',billTotal:2030,verifiedAmount:2030,ocrAmount:2030,appliedAmount:2030,remainingBalance:0,unitAdvanceBalance:0,unappliedAmount:0,allocations:[]}
 await context.addInitScript(user=>{localStorage.setItem('condo_token','mock-only');localStorage.setItem('condo_user',JSON.stringify(user))},user)
 await context.route('**/api/**',route=>{
  const req=route.request(),path=new URL(req.url()).pathname;assert.equal(req.method(),'GET','Receipt checks must be read-only')
  if(path==='/api/payments/171/receipt')return route.fulfill({contentType:'image/png',body:receipt})
  const data=path==='/api/auth/me'?{user}:path==='/api/notifications'?{notifications:[],unreadCount:0}:path==='/api/payments/171'?{payment}:null
  assert.ok(data,path);return route.fulfill({contentType:'application/json',body:JSON.stringify(data)})
 })
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message))
 if(!receipt)receipt=await makeImage(page,1200,1200)
 await page.goto('http://localhost:5173/admin/payments/171')
 const viewer=page.getByRole('region',{name:'Receipt viewer',exact:true}),viewport=page.getByRole('region',{name:/^Scrollable receipt image/})
 const image=page.getByAltText('Uploaded payment receipt',{exact:true});await image.waitFor()
 await page.getByRole('button',{name:'Zoom in receipt',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('img[alt="Uploaded payment receipt"]')?.naturalWidth>0)
 return {context,page,viewer,viewport}
}
async function metrics(viewport) {return viewport.evaluate(el=>{const box=el.getBoundingClientRect(),image=el.querySelector('img').getBoundingClientRect();return{width:el.clientWidth,height:el.clientHeight,imageWidth:image.width,imageHeight:image.height,left:el.scrollLeft,top:el.scrollTop,maxX:el.scrollWidth-el.clientWidth,maxY:el.scrollHeight-el.clientHeight,imageLeft:image.left-box.left,imageTop:image.top-box.top,imageRight:image.right-box.right,imageBottom:image.bottom-box.bottom}})}
async function zoomFully(page) {for(let i=0;i<6;i++)await page.getByRole('button',{name:'Zoom in receipt',exact:true}).click();assert.equal(await page.getByLabel('Receipt zoom',{exact:true}).textContent(),'250%')}
async function verifyEdges(viewport) {
 await viewport.evaluate(el=>el.scrollTo(0,0));let m=await metrics(viewport);assert.equal(m.left,0);assert.equal(m.top,0);assert.ok(m.imageLeft>=0&&m.imageTop>=0,'top and left image edges must be reachable')
 await viewport.evaluate(el=>el.scrollTo(el.scrollWidth,el.scrollHeight));m=await metrics(viewport);assert.ok(m.imageRight<=1&&m.imageBottom<=1,'bottom and right image edges must be reachable')
}
try {
 let {context,page,viewer,viewport}=await open()
 assert.equal(await page.getByText('Reference number',{exact:true}).count(),1);assert.equal(await page.getByText('OR number',{exact:true}).count(),0)
 await zoomFully(page);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);let m=await metrics(viewport);assert.ok(m.maxX>0&&m.maxY>0,JSON.stringify(m))
 const toolbar=viewer.getByRole('toolbar');const toolbarTop=(await toolbar.boundingBox()).y
 await verifyEdges(viewport);assert.equal((await toolbar.boundingBox()).y,toolbarTop)
 await viewport.evaluate(el=>el.scrollTo((el.scrollWidth-el.clientWidth)/2,(el.scrollHeight-el.clientHeight)/2))
 const before=await metrics(viewport),box=await viewport.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+80,y+70,{steps:8});await page.mouse.up()
 m=await metrics(viewport);assert.ok(Math.abs(m.left-(before.left-80))<3&&Math.abs(m.top-(before.top-70))<3,'drag must move left and up')
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-80,y-70,{steps:8});await page.mouse.up()
 m=await metrics(viewport);assert.ok(Math.abs(m.left-before.left)<3&&Math.abs(m.top-before.top)<3,'drag must move right and down')
 await viewport.focus();const beforeKey=await metrics(viewport);await page.keyboard.press('ArrowUp')
 await page.waitForFunction(top=>document.querySelector('[aria-label^="Scrollable receipt image"]').scrollTop<top,beforeKey.top)
 await viewer.screenshot({path:`${output}/zoom-desktop.png`})
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download receipt image',exact:true}).click()]);assert.equal(download.suggestedFilename(),'payment-receipt-171.png')
 await page.getByRole('button',{name:'Reset receipt zoom',exact:true}).click();assert.equal(await page.getByLabel('Receipt zoom',{exact:true}).textContent(),'100%')
 await page.waitForFunction(()=>{const el=document.querySelector('[aria-label^="Scrollable receipt image"]');return el.scrollWidth===el.clientWidth&&el.scrollHeight===el.clientHeight})
 await page.getByRole('button',{name:'Zoom out receipt',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Zoom out receipt',exact:true}).isDisabled(),true)
 receipt=await makeImage(page,320,1500);await page.reload();await page.getByRole('button',{name:'Zoom in receipt',exact:true}).waitFor();await zoomFully(page);await verifyEdges(viewport)
 await viewer.screenshot({path:`${output}/zoom-tall-receipt.png`});await context.close()
 console.log('PASS desktop zoom, all four image edges, drag in four directions, keyboard scroll, reset, tall receipt and download')
 receipt=null
 ;({context,page,viewer,viewport}=await open(true))
 await zoomFully(page);await viewport.scrollIntoViewIfNeeded();await verifyEdges(viewport)
 await viewport.evaluate(el=>el.scrollTo((el.scrollWidth-el.clientWidth)/2,(el.scrollHeight-el.clientHeight)/2))
 const mobileBefore=await metrics(viewport),mobileBox=await viewport.boundingBox(),tx=mobileBox.x+mobileBox.width/2,ty=mobileBox.y+mobileBox.height/2
 const cdp=await context.newCDPSession(page)
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:tx,y:ty}]})
 for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:tx-i*10,y:ty-i*10}]});await page.waitForTimeout(16)}
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
 await page.waitForFunction(({left,top})=>{const el=document.querySelector('[aria-label^="Scrollable receipt image"]');return el.scrollLeft>left+30&&el.scrollTop>top+30},mobileBefore)
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 await viewer.screenshot({path:`${output}/zoom-mobile.png`});await context.close();assert.deepEqual(errors,[])
 console.log('PASS mobile two-axis touch scrolling, contained layout and Reference number label. All API requests mocked.')
} finally {await browser.close()}
