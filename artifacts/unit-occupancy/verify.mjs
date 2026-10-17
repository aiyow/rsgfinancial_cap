import { chromium } from 'file:///C:/Users/yaoim/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
  const context = await browser.newContext({viewport:{width:1366,height:900}});
  const user = {id:1,fullName:'Test Admin',email:'admin@example.invalid',role:'ADMIN'};
  const resident = {id:2,fullName:'Test Resident',email:'resident@example.invalid',role:'RESIDENT',isActive:true};
  let unit = {id:10,unitNumber:'Test 2A',floor:'2',billableAreaSqm:12.07,occupancyStatus:'VACANT'};
  let assignments = [], savedBody;
  await context.addInitScript(user => {
    localStorage.setItem('condo_token','unit-occupancy-preview');
    localStorage.setItem('condo_user',JSON.stringify(user));
  },user);
  await context.route('**/api/**',async route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    let json = {};
    if(path === '/api/auth/me') json = {user};
    if(path === '/api/users') json = {users:[resident]};
    if(path === '/api/units') json = {units:[unit]};
    if(path === '/api/unit-assignments' && method === 'GET') json = {assignments};
    if(path === '/api/unit-assignments' && method === 'POST') {
      const body = route.request().postDataJSON();
      unit = {...unit,occupancyStatus:'OCCUPIED'};
      const assignment = {...body,id:1,userId:2,unitId:10,residentName:resident.fullName,residentEmail:resident.email,endDate:null};
      assignments = [assignment];
      json = {assignment};
    }
    if(path === '/api/units/10' && method === 'PATCH') {
      savedBody = route.request().postDataJSON();
      unit = {...unit,...savedBody};
      json = {unit};
    }
    if(path === '/api/bills') json = {bills:[]};
    if(path === '/api/payments') json = {payments:[]};
    if(path === '/api/notifications') json = {notifications:[],unreadCount:0};
    await route.fulfill({json});
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:5173/admin/units/manage');
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Vacant',{exact:true}).waitFor();
  await dialog.getByLabel('Floor',{exact:true}).fill('Unsaved floor');
  await dialog.getByPlaceholder('Search name or email').fill('Test Resident');
  await dialog.getByRole('option',{name:/Test Resident/}).click();
  await dialog.getByRole('button',{name:'Add resident assignment',exact:true}).click();
  await dialog.getByText('Set automatically when a resident is assigned.',{exact:true}).waitFor();
  assert.equal(await dialog.getByLabel('Floor',{exact:true}).inputValue(),'Unsaved floor');
  await dialog.getByText('Occupied',{exact:true}).waitFor();
  assert.equal(await dialog.getByText('Vacant',{exact:true}).count(),0);
  await page.screenshot({path:'artifacts/unit-occupancy/assigned-unit.png',fullPage:true});
  await dialog.getByRole('button',{name:'Save unit changes',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  assert.equal(savedBody.occupancyStatus,'OCCUPIED');
  assert.equal(savedBody.floor,'Unsaved floor');
  await page.locator('tbody tr').filter({hasText:'Test 2A'}).getByText('Occupied',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: assignment updates the editor and table, preserves unsaved fields, and subsequent unit save sends OCCUPIED.');
} finally { await browser.close(); }


