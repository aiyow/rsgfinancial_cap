import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import pool from '../../backend/config/db.js';
import { analyticsPeriodCondition } from '../../backend/services/analyticsPeriods.js';
const client=await pool.connect();
try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const result=await client.query(`SELECT DISTINCT ON (f.unit_id)
    f.id AS "forecastId", u.unit_number AS "unitNumber", f.forecast_for_month AS "forecastForMonth",
    p.period_start AS "sourceMonth", m.current_reading AS "previousReading",
    m.validation_status AS "sourceValidationStatus", p.water_rate_per_cubic_m AS "waterRate",
    f.predicted_consumption AS "predictedConsumption", f.estimated_water_charge AS "estimatedWaterCharge",
    f.model_name AS "modelName", f.forecast_status AS status, f.status_reason AS reason,
    f.sample_count AS "sampleCount", f.generated_at AS "generatedAt"
    FROM billing_forecasts f JOIN units u ON u.id=f.unit_id JOIN billing_periods p ON p.id=f.based_on_period_id
    LEFT JOIN meter_readings m ON m.unit_id=f.unit_id AND m.billing_period_id=f.based_on_period_id
    WHERE f.forecast_for_month=$1 AND ${analyticsPeriodCondition('p')}
    ORDER BY f.unit_id,p.period_start DESC,f.generated_at DESC`,['2026-10-01']);
  const units=await client.query('SELECT COUNT(*)::int AS count FROM units');
  await client.query('COMMIT');
  const rows=result.rows.sort((a,b)=>a.unitNumber.localeCompare(b.unitNumber,undefined,{numeric:true}));
  assert.equal(rows.length,units.rows[0].count,'Every unit must appear in the saved October forecast.');
  assert.equal(new Set(rows.map(row=>row.unitNumber)).size,rows.length);
  const number=value=>value===null?null:Number(value);
  for(const row of rows) {
    for(const key of ['previousReading','waterRate','predictedConsumption','estimatedWaterCharge']) row[key]=number(row[key]);
    if(row.status==='READY') assert.ok(Number.isFinite(row.predictedConsumption)&&row.predictedConsumption>=0);
    else assert.equal(row.predictedConsumption,null);
  }
  const counts=rows.reduce((counts,row)=>{const key=row.status==='READY'?row.modelName:'NO_FORECAST';counts[key]=(counts[key]||0)+1;return counts;},{});
  const dataset={capturedAt:new Date().toISOString(),forecastForMonth:'2026-10-01',source:'Saved system forecasts',rows,counts};
  await writeFile(new URL('october-saved-forecasts.json',import.meta.url),JSON.stringify(dataset,null,2));
  console.log(JSON.stringify({rows:rows.length,counts,sourceMonths:[...new Set(rows.map(row=>row.sourceMonth))],
    noForecast:rows.filter(row=>row.status!=='READY').map(row=>({unitNumber:row.unitNumber,status:row.status,reason:row.reason}))},null,2));
} finally {await client.query('ROLLBACK').catch(()=>{});client.release();await pool.end();}
