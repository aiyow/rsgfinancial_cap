import assert from 'node:assert/strict';
import test from 'node:test';
import { compareForecastPolicies } from '../services/forecastPolicyComparison.js';

const dataset = () => ({ capturedAt:'test', units:[{unitId:1},{unitId:2}],
  periods:Array.from({length:10},(_,i)=>({id:i+1,periodStart:`2025-${String(i+1).padStart(2,'0')}-05`})),
  readings:[1,2].flatMap(unitId=>[10,10,10,10,10,30,10,0,10,10].map((consumption,i)=>({
    unitId,periodStart:`2025-${String(i+1).padStart(2,'0')}-05`,consumption:String(consumption),validationStatus:'VALID',
  }))),
});
test('compares identical pairs including spikes and zeros, with transparent exclusions and model counts',()=>{
  const report=compareForecastPolicies(dataset());
  assert.equal(report.evaluatedCount,10);
  assert.equal(report.eligibilityMismatchCount,0);
  assert.equal(report.pairs.filter(row=>row.actualConsumption===0).length,2);
  assert.equal(report.pairs.filter(row=>row.actualConsumption===30).length,2);
  for(const policy of ['stable','regression_first']) {
    const metrics=report.aggregate[policy];
    assert.equal(metrics.evaluatedCount,10);
    assert.equal(Object.values(metrics.modelCounts).reduce((a,b)=>a+b,0),10);
    assert.ok(metrics.mae>0 && metrics.rmse>0 && metrics.wape>0);
    assert.equal(Object.values(report.latest.modelCounts[policy]).reduce((a,b)=>a+b,0),2);
  }
  assert.equal(report.monthly[0].exclusions.unavailableForecast,2);
  assert.equal(report.monthly.at(-1).exclusions.missingActual,2);
});
test('only eligibility or invalid actuals exclude pairs; future changes never leak into earlier predictions',()=>{
  const data=dataset();
  data.readings.find(row=>row.unitId===2&&row.periodStart==='2025-10-05').validationStatus='FLAGGED';
  const before=compareForecastPolicies(data);
  assert.equal(before.evaluatedCount,9);
  data.readings.filter(row=>row.periodStart==='2025-10-05').forEach(row=>{row.consumption=999;});
  const after=compareForecastPolicies(data);
  assert.deepEqual(after.pairs.map(row=>row.predictions),before.pairs.map(row=>row.predictions));
  assert.equal(before.monthly[8].exclusions.invalidOrFlaggedActual,1);
});
