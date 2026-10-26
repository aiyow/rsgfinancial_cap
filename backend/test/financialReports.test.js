import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateFinancialCollection, calculateCollectionEfficiency, parseFinancialReportFilters, buildCombinedReport } from '../services/financialReports.js';

test('defaults financial reports to the current calendar month', () => {
  const result = parseFinancialReportFilters({}, new Date('2026-09-16T08:00:00.000Z'));
  assert.deepEqual(result, {
    mode: 'MONTH', month: '2026-09', startDate: '2026-09-01', endDate: '2026-09-30', label: '2026-09',
  });
});

test('accepts an inclusive custom report date range', () => {
  assert.deepEqual(parseFinancialReportFilters({ startDate: '2026-02-03', endDate: '2026-02-28' }), {
    mode: 'DATE_RANGE', month: null, startDate: '2026-02-03', endDate: '2026-02-28', label: '2026-02-03 to 2026-02-28',
  });
});

test('rejects mixed, incomplete, and reversed financial report filters', () => {
  assert.throws(() => parseFinancialReportFilters({ month: '2026-02', startDate: '2026-02-01', endDate: '2026-02-28' }), /either a month or a date range/);
  assert.throws(() => parseFinancialReportFilters({ startDate: '2026-02-01' }), /both startDate and endDate/);
  assert.throws(() => parseFinancialReportFilters({ startDate: '2026-02-28', endDate: '2026-02-01' }), /cannot be after/);
});

test('uses actual water applications rather than a proportional whole-SOA estimate', () => {
  const result = allocateFinancialCollection({ chargeType: 'WATER', amountApplied: 525 });
  assert.deepEqual(result, { waterCollected: 525, duesCollected: 0, latePenaltyCollected: 0 });
  assert.equal(result.waterCollected + result.duesCollected + result.latePenaltyCollected, 525);
});

test('reports association principal and penalties independently without double counting', () => {
  const result = allocateFinancialCollection({ chargeType: 'ASSOCIATION_DUES', component: 'LATE_PENALTY', amountApplied: 1 });
  assert.equal(result.waterCollected + result.duesCollected + result.latePenaltyCollected, 1);
  assert.deepEqual(result, { waterCollected: 0, duesCollected: 0, latePenaltyCollected: 1 });
  assert.deepEqual(allocateFinancialCollection({ chargeType: 'ASSOCIATION_DUES', amountApplied: 10.01 }), { waterCollected: 0, duesCollected: 10.01, latePenaltyCollected: 0 });
  assert.throws(() => allocateFinancialCollection({ chargeType: 'WATER', component: 'LATE_PENALTY', amountApplied: 1 }));
});

test('calculates collection efficiency from approved collections and billed amounts', () => {
  assert.equal(calculateCollectionEfficiency(750, 1000), 75);
  assert.equal(calculateCollectionEfficiency(1000, 0), null);
});


test('combined unit report includes paid, partial, unpaid, zero-charge and unbilled directory units', () => {
  const units=[{unitId:1,unitNumber:'10',residentNames:'Current Name'},{unitId:2,unitNumber:'2'},
    {unitId:3,unitNumber:'11'},{unitId:4,unitNumber:'12'},{unitId:5,unitNumber:'13',residentNames:'Directory Only'}];
  const bill=(billId,unitId,duesBilled,waterBilled,latePenalty=0,payerName='Snapshot')=>({billId,unitId,duesBilled,waterBilled,latePenalty,payerName});
  const report=buildCombinedReport([bill(1,1,10.01,2.02,1.03,'Old Payer'),bill(2,1,1,2,0,'Other Payer'),
    bill(3,2,5,10),bill(4,3,0,0),bill(5,4,0,8.99)],new Map([[1,10.05],[2,100],[3,15]]),units,'2026-10-31');
  assert.deepEqual(report.rows.map(row=>row.unitNumber),['2','10','11','12','13']);
  assert.deepEqual(report.rows.map(row=>row.status),['PAID','PARTIAL','NO_CHARGES','UNPAID','NO_SOA']);
  const partial=report.rows[1];assert.equal(partial.billCount,2);assert.equal(partial.payerName,'Old Payer, Other Payer');
  assert.equal(partial.totalBilled,16.06);assert.equal(partial.paidAmount,13.05);assert.equal(partial.remainingBalance,3.01);
  assert.equal(report.rows[4].payerName,'Directory Only');
  assert.deepEqual(report.totals,{duesBilled:16.01,waterBilled:23.01,latePenalty:1.03,totalBilled:40.05,paidAmount:28.05,remainingBalance:12});
  assert.equal(Math.round((report.totals.totalBilled-report.totals.paidAmount)*100),Math.round(report.totals.remainingBalance*100));
});
test('combined report preserves selected bill units missing from the directory and handles an empty directory',()=>{
 const report=buildCombinedReport([{billId:1,unitId:99,unitNumber:'99',duesBilled:'0.10',waterBilled:'0.20',latePenalty:'0.00',payerName:'Saved Payer'}],new Map(),[],'2026-10-31');
 assert.equal(report.rows[0].status,'UNPAID');assert.equal(report.totals.totalBilled,0.3);
 assert.deepEqual(buildCombinedReport([],new Map(),[],'2026-10-31').rows,[]);
 assert.equal(buildCombinedReport([],new Map(),[],'2026-10-31').totals.totalBilled,0);
});
