import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTIVE_FORECAST_POLICY,
  buildForecast,
  linearRegression,
  regenerateForecasts,
  classifyUsageChange,
} from "../services/analytics.js";

const history = (values) => values.map((consumption, index) => ({
  periodStart: new Date(Date.UTC(2025, index, 5)).toISOString().slice(0, 10), consumption, validationStatus: 'VALID',
}));
const forecast = (values, options) => buildForecast(history(values), options);
const regression = (values) => assert.equal(forecast(values).modelName, 'LINEAR_REGRESSION');
const stable = (values) => assert.equal(forecast(values).modelName, 'STABLE_RECENT_ENSEMBLE');

test('regression is active for normal fluctuations, exact trends, regular zeros and all zeros', () => {
  assert.equal(ACTIVE_FORECAST_POLICY, 'regression_first');
  for (const values of [[10,11,9,10,12,10,11], [2,4,6,8,10,12,14], [7,6,5,4,3,2,1],
    [0,0,0,0,0,0,0], [1,0,1,0,1,0,1,0], [10,10,10,10,10,1]]) {
    regression(values);
    assert.equal(forecast(values).predictedConsumption, Number(linearRegression(values).predicted.toFixed(3)));
    assert.match(forecast(values).reason, /Linear Regression: no qualifying/);
  }
});
test('each event requires five earlier months, and six readings can already activate stable', () => {
  regression([10,10,10,10,100]);
  stable([10,10,10,10,10,30]);
  stable([10,10,10,10,10,0]);
  assert.match(forecast([10,10,10,10,10,30]).reason, /high consumption in Jun 2025/);
});
test('spike thresholds are strict at minimum, relative and MAD boundaries', () => {
  for (const [baseline, boundary] of [[[0,0,0,0,0],3], [[10,10,10,10,10],17.5], [[1,5,10,15,20],25]]) {
    regression([...baseline,boundary]);
    stable([...baseline,boundary+0.001]);
  }
});
test('unexpected zero requires median at least one and three immediately preceding positive months', () => {
  stable([1,1,1,1,1,0]);
  regression([0.999,0.999,0.999,0.999,0.999,0]);
  regression([10,10,0,10,10,0]);
  // An older zero outside the immediately preceding three does not suppress a new event.
  stable([0,10,10,10,10,0]);
});
test('spike activation expires after the event leaves the latest three months', () => {
  const values = [10,10,10,10,10,30];
  for (let age=0; age<3; age+=1) stable([...values,...Array(age).fill(10)]);
  regression([...values,10,10,10]);
});
test('repeated zeros do not restart the event window', () => {
  for (let zeros=1; zeros<=3; zeros+=1) stable([10,10,10,10,10,...Array(zeros).fill(0)]);
  regression([10,10,10,10,10,0,0,0,0]);
});
test('most recent qualifying event explains selection; an ordinary drop does not hide a spike', () => {
  assert.match(forecast([10,10,10,10,10,30,10,0]).reason, /unexpected zero consumption in Aug 2025/);
  assert.match(forecast([10,10,10,10,10,30,1]).reason, /high consumption in Jun 2025/);
});
test('formula, charge rounding, numeric strings and original readings are preserved', () => {
  const values = [10,10,10,10,10,30];
  const readings = history(values.map(String));
  const original = structuredClone(readings);
  const result = buildForecast(readings, { waterRate: '23' });
  assert.equal(result.predictedConsumption, Number(((30+50/3+10)/3).toFixed(3)));
  assert.equal(result.estimatedWaterCharge, Number((result.predictedConsumption*23).toFixed(2)));
  assert.equal(result.slope, null);
  assert.equal(result.intercept, null);
  assert.deepEqual(result, forecast(values, { waterRate: 23 }));
  assert.deepEqual(readings, original);
});
test('flagged readings, gaps and invalid values still interrupt eligibility and event baselines', () => {
  const readings = history([10,10,10,10,10,30,10,10,10,10,30]);
  const flagged = readings.map((row,index) => index===5 ? {...row,validationStatus:'FLAGGED'} : row);
  const result = buildForecast(flagged);
  assert.equal(result.sampleCount,5);
  assert.equal(result.modelName,'LINEAR_REGRESSION');
  assert.equal(buildForecast(flagged.slice(0,-1)).status,'INSUFFICIENT_DATA');
  assert.equal(buildForecast(readings.filter((_,index)=>index!==5)).modelName,'LINEAR_REGRESSION');
  assert.equal(buildForecast([...readings.slice(0,-1),{...readings.at(-1),validationStatus:'FLAGGED'}]).status,'FLAGGED_READING');
  for (const consumption of [null,'',false,-1]) {
    assert.equal(buildForecast([...readings.slice(0,-1),{...readings.at(-1),consumption}]).status,'INSUFFICIENT_DATA');
  }
});
test('future values and validation flags cannot affect prediction or the event baseline', () => {
  const readings = history([10,10,10,10,10,30,10,10,999,0]);
  const sourceMonth = '2025-08-05';
  const expected = buildForecast(readings.slice(0,8),{sourceMonth});
  assert.deepEqual(buildForecast(readings,{sourceMonth}),expected);
  assert.deepEqual(buildForecast(readings.map((row,i)=>i>=8?{...row,consumption:null,validationStatus:'FLAGGED'}:row),{sourceMonth}),expected);
});
test('selected training history remains capped at twelve and no earlier baseline is borrowed', () => {
  const result = forecast([999,...Array(15).fill(10)]);
  assert.equal(result.sampleCount,12);
  assert.equal(result.modelName,'LINEAR_REGRESSION');
});
test('shared helper validates numeric inputs and retains usage-drop review classification', () => {
  assert.equal(classifyUsageChange([10,10,10,10],30),null);
  for (const value of [null,'',false,Infinity,-1]) assert.equal(classifyUsageChange([10,10,10,10,value],30),null);
  assert.equal(classifyUsageChange([10,10,10,10,10],1).type,'USAGE_DROP');
});
test('saved forecast generation persists the selection explanation without changing model identifiers', async () => {
  let inserted;
  const client={async query(sql,params) {
    if(sql.startsWith('SELECT id, period_start')) return {rows:[{periodStart:'2025-06-05',waterRate:23}]};
    if(sql.includes('FROM meter_readings')) return {rows:history([10,10,10,10,10,30]).map(row=>({...row,unitId:1}))};
    if(sql==='SELECT id FROM units ORDER BY id') return {rows:[{id:1}]};
    if(sql.includes('INSERT INTO billing_forecasts')) inserted=params;
    return {rows:[]};
  }};
  await regenerateForecasts(client,6);
  assert.equal(inserted[5],'STABLE_RECENT_ENSEMBLE');
  assert.equal(inserted[9],'READY');
  assert.match(inserted[10],/high consumption in Jun 2025/);
});
