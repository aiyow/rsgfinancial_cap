import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const source=JSON.parse(await fs.readFile(new URL('october-saved-forecasts.json',import.meta.url),'utf8'));
const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(fileURLToPath(new URL('../../ml/excel predictive data/september.xlsx',import.meta.url))));
const sheet=wb.worksheets.getItem('Cleaned Readings');
const last=source.rows.length+1;
const original=sheet.getRange(`A2:D${last}`).values;
const forecasts=new Map(source.rows.map(row=>[String(row.unitNumber),row]));
// A fixed seed makes the generated example reproducible and stable when opened.
let state=202610;
function random() {
  state=(Math.imul(state,1664525)+1013904223)>>>0;
  return state/4294967296;
}
const missing=source.rows.filter(row=>row.status!=='READY').map(row=>row.unitNumber);
const ready=source.rows.filter(row=>row.status==='READY').map(row=>row.unitNumber);
for(let i=ready.length-1;i>0;i--) {
  const j=Math.floor(random()*(i+1));
  [ready[i],ready[j]]=[ready[j],ready[i]];
}
const generatedCount=Math.round(source.rows.length*0.2);
const generated=new Set([...missing,...ready.slice(0,generatedCount-missing.length)]);
const provenance=[];
const rows=original.map(([unit,septemberPrevious,septemberPresent])=>{
  const key=String(unit),forecast=forecasts.get(key);
  assert.ok(forecast,`No October source row for ${unit}`);
  assert.ok(Math.abs(septemberPresent-forecast.previousReading)<1e-9);
  const septemberConsumption=Number((septemberPresent-septemberPrevious).toFixed(3));
  assert.ok(septemberConsumption>=0);
  let consumption=forecast.predictedConsumption;
  const mode=generated.has(key)?'GENERATED_NEAR_SEPTEMBER':'SYSTEM_PREDICTION';
  let adjustment=null;
  if(generated.has(key)) {
    adjustment=(random()*2-1)*0.05;
    consumption=Number((septemberConsumption*(1+adjustment)).toFixed(3));
  }
  assert.ok(Number.isFinite(consumption)&&consumption>=0);
  const present=Number((septemberPresent+consumption).toFixed(3));
  provenance.push({unitNumber:key,septemberPrevious,septemberPresent,septemberConsumption,
    octoberConsumption:consumption,octoberPresent:present,mode,adjustment,
    savedPrediction:forecast.predictedConsumption});
  return [unit,septemberPresent,present,null];
});
// Values assignments preserve imported formulas, so clear contents explicitly first.
// B and C are fixed numeric readings; D alone derives consumption from C minus B.
sheet.getRange(`A2:D${last}`).clear({applyTo:'contents'});
sheet.getRange(`A2:D${last}`).values=rows;
sheet.getRange(`D2:D${last}`).formulas=rows.map((_,i)=>[`=ROUND(C${i+2}-B${i+2},3)`]);
wb.recalculate();
const result=sheet.getRange(`A2:D${last}`).values;
const formulas=sheet.getRange(`A2:D${last}`).formulas;
for(let i=0;i<rows.length;i++) {
  const [unit,previous,present,consumption]=result[i],check=provenance[i];
  assert.equal(String(unit),check.unitNumber);
  assert.equal(previous,original[i][2]);
  assert.equal(present,check.octoberPresent);
  assert.ok(Math.abs(consumption-check.octoberConsumption)<1e-9);
  assert.equal(formulas[i][0]||'', '');
  assert.equal(formulas[i][1]||'', '');
  assert.equal(formulas[i][2]||'', '');
  assert.equal(formulas[i][3],`=ROUND(C${i+2}-B${i+2},3)`);
  if(check.mode==='GENERATED_NEAR_SEPTEMBER') {
    assert.ok(Math.abs(consumption-check.septemberConsumption)<=check.septemberConsumption*0.05+0.0005);
  } else assert.equal(consumption,forecasts.get(check.unitNumber).predictedConsumption);
}
assert.deepEqual(sheet.getRange('A1:D1').values,[['Unit','Previous','Present','Consumption']]);
// Verify the only dependency goes from fixed readings to consumption, then restore.
const beforeC=sheet.getRange('C2').values[0][0],beforeD=sheet.getRange('D2').values[0][0];
sheet.getRange('C2').values=[[Number((beforeC+0.123).toFixed(3))]];
assert.ok(Math.abs(sheet.getRange('D2').values[0][0]-(beforeD+0.123))<1e-9);
sheet.getRange('C2').values=[[beforeC]];
wb.recalculate();
const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!',options:{useRegex:true,maxResults:20}});
console.log(errors.ndjson);
const preview=await wb.render({sheetName:sheet.name,range:'A1:D18',scale:1.5,format:'png'});
await fs.writeFile(new URL('october-simulated-preview.png',import.meta.url),new Uint8Array(await preview.arrayBuffer()));
const output=await SpreadsheetFile.exportXlsx(wb);
await output.save(fileURLToPath(new URL('october_2026_SIMULATED_readings.xlsx',import.meta.url)));
await fs.writeFile(new URL('october-simulation-provenance.json',import.meta.url),JSON.stringify({
  label:'SIMULATED test readings, not measured October usage',sourceCapturedAt:source.capturedAt,seed:202610,
  systemPredictionCount:source.rows.length-generatedCount,generatedCount,
  generatedRule:'September consumption adjusted by up to 5%, rounded to 0.001 m3. A zero September value remains zero.',
  formulas:'Present is a fixed numeric value. Consumption = ROUND(Present - Previous, 3).',rows:provenance},null,2));
console.log(JSON.stringify({exported:true,units:result.length,systemPredictions:source.rows.length-generatedCount,
  generated:generatedCount,unavailableForecastsFilled:missing,circularDependencies:false}));
