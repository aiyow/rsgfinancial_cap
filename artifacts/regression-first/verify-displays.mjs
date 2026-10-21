import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pool from '../../backend/config/db.js';
import router from '../../backend/routes/analyticsRoutes.js';
import { chromium } from 'file:///C:/Users/yaoim/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

async function invoke(path,request={}) {
  const route=router.stack.find(layer=>layer.route?.path===path)?.route;
  assert.ok(route);
  let response;
  await route.stack.at(-1).handle(request,{json(value){response=value;return this;},status(){return this;}},error=>{throw error;});
  assert.ok(response);
  return response;
}
const client=await pool.connect();
const originalQuery=pool.query;
let overview;
let residentCases=[];
const unitDetails=new Map();
try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  pool.query=client.query.bind(client);
  overview=await invoke('/overview');
  assert.ok(overview.diagnostics.some(row=>row.modelName==='LINEAR_REGRESSION'&&row.status==='READY'));
  assert.ok(overview.diagnostics.some(row=>row.modelName==='STABLE_RECENT_ENSEMBLE'&&row.status==='READY'));
  assert.ok(overview.diagnostics.some(row=>row.status!=='READY'));
  for(const row of overview.diagnostics) assert.ok(row.reason);
  for(const model of ['LINEAR_REGRESSION','STABLE_RECENT_ENSEMBLE']) {
    const assignment=await client.query(`SELECT a.user_id FROM unit_assignments a JOIN users u ON u.id=a.user_id
      JOIN billing_forecasts f ON f.unit_id=a.unit_id
      WHERE a.end_date IS NULL AND u.role='RESIDENT' AND f.forecast_status='READY' AND f.model_name=$1
      AND f.forecast_for_month=(SELECT MAX(forecast_for_month) FROM billing_forecasts)
      ORDER BY a.user_id LIMIT 1`,[model]);
    assert.ok(assignment.rows.length,'Resident assignment for '+model);
    const resident=await invoke('/resident',{user:{id:assignment.rows[0].user_id}});
    const unit=resident.units.find(unit=>unit.forecast?.status==='READY'&&unit.forecast.modelName===model);
    assert.ok(unit?.forecast.reason);
    residentCases.push({model,unit});
    unitDetails.set(String(unit.id),await invoke('/units/:id',{resourceId:unit.id}));
  }
  const recommendations=await client.query(`SELECT COUNT(*)::int AS count,
    COUNT(*) FILTER (WHERE r.forecast_id IS NULL)::int AS missing
    FROM prescriptive_recommendations r WHERE r.status!='SUPERSEDED'
    AND r.based_on_period_id=(SELECT based_on_period_id FROM billing_forecasts ORDER BY forecast_for_month DESC LIMIT 1)`);
  assert.ok(recommendations.rows[0].count>0);
  assert.equal(recommendations.rows[0].missing,0);
  console.log(JSON.stringify({readOnlyApiVerified:true,staffRows:overview.diagnostics.length,
    residentModels:residentCases.map(row=>row.model),recommendations:recommendations.rows[0]}));
} finally {
  pool.query=originalQuery;
  await client.query('ROLLBACK');client.release();await pool.end();
}
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[];
try {
  for(const role of ['ADMIN','COLLECTOR','RESIDENT']) {
    const context=await browser.newContext({viewport:{width:1366,height:900}});
    const user={id:1,role,fullName:'Forecast Verification',email:'preview@example.invalid'};
    let selectedCase=residentCases[0];
    await context.addInitScript(user=>{
      localStorage.setItem('condo_token','forecast-preview');localStorage.setItem('condo_user',JSON.stringify(user));
    },user);
    await context.route('**/api/**',async route=>{
      const path=new URL(route.request().url()).pathname;
      assert.equal(route.request().method(),'GET','Display checks must be read-only');
      let json={};
      if(path==='/api/auth/me')json={user};
      if(path==='/api/notifications')json={notifications:[],unreadCount:0};
      if(path.startsWith('/api/prescriptive-recommendations'))json={recommendations:[]};
      if(path==='/api/bills')json={bills:[]};
      if(path==='/api/analytics/overview')json=overview;
      if(path==='/api/analytics/resident')json={units:[selectedCase.unit]};
      if(path==='/api/units')json={units:residentCases.map(row=>({...row.unit,floor:'2'}))};
      if(path.startsWith('/api/analytics/units/'))json=unitDetails.get(path.split('/').at(-1));
      await route.fulfill({json});
    });
    const page=await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror',error=>errors.push(error.message));
    if(role==='RESIDENT') {
      for(const item of residentCases) {
        selectedCase=item;
        await page.goto('http://localhost:5173/resident');
        await page.getByText('Next-month estimate',{exact:true}).waitFor();
        assert((await page.locator('body').innerText()).includes(Number(item.unit.forecast.predictedConsumption).toFixed(3)));
        assert.equal(await page.getByText(item.unit.forecast.reason,{exact:true}).count(),0,'Ready reason must not become a warning');
        assert.ok(await page.getByText('Estimated Water Bill',{exact:true}).count()>0);
        await page.getByRole('heading',{name:'Water consumption',exact:true}).scrollIntoViewIfNeeded();
        await page.screenshot({path:fileURLToPath(new URL(`resident-${item.model}.png`,import.meta.url))});
      }
    } else {
      await page.goto(`http://localhost:5173/${role.toLowerCase()==='admin'?'admin':'collector'}/analytics`);
      const table=page.getByLabel('Predicted versus actual results',{exact:true});
      await table.getByText('No forecast',{exact:true}).first().waitFor();
      for(const row of overview.diagnostics.filter(row=>row.status!=='READY')) {
        const tr=table.getByRole('row').filter({has:page.getByText(`Unit ${row.unitNumber}`,{exact:true})});
        assert((await tr.innerText()).includes('No forecast'));
        assert(!(await tr.innerText()).includes('LINEAR REGRESSION'));
      }
      for(const model of ['LINEAR_REGRESSION','STABLE_RECENT_ENSEMBLE']) {
        const row=overview.diagnostics.find(row=>row.status==='READY'&&row.modelName===model);
        const tr=table.getByRole('row').filter({has:page.getByText(`Unit ${row.unitNumber}`,{exact:true})});
        assert((await tr.innerText()).includes(row.reason));
        assert((await tr.innerText()).includes(model==='LINEAR_REGRESSION'?'LINEAR REGRESSION':'Stable Recent Months'));
      }
      await table.scrollIntoViewIfNeeded();
      await table.screenshot({path:fileURLToPath(new URL(`${role.toLowerCase()}-models.png`,import.meta.url))});
      await page.setViewportSize({width:390,height:844});
      await page.waitForFunction(()=>document.documentElement.scrollWidth<=window.innerWidth,{},{timeout:10000});
    }
    await context.close();
  }
  assert.deepEqual(errors,[]);
  await writeFile(new URL('display-verification.json',import.meta.url),JSON.stringify({verifiedAt:new Date().toISOString(),
    readOnlyApi:true,staffRoles:['ADMIN','COLLECTOR'],residentModels:residentCases.map(row=>row.model),browserErrors:errors},null,2));
  console.log('PASS: refreshed admin/collector model explanations, unavailable labels, mobile bounds, and both resident forecast displays.');
} finally {await browser.close();}
