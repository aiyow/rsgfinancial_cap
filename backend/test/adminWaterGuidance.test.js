import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAdminWaterGuidance, loadAdminWaterGuidance } from '../services/adminWaterGuidance.js';

const source = { id: 5, periodStart: '2026-10-05', periodEnd: '2026-11-05', periodType: 'HISTORICAL_ANALYTICS', waterRate: 23 };
function fixture(values = [10], predictions = [12]) {
  return { source, units: values.map((_, index) => ({ id: index + 1, occupancyStatus: 'OCCUPIED' })),
    history: values.flatMap((value, index) => [8, 9, 10].map(month => ({ unitId: index + 1, billingPeriodId: month === 10 ? 5 : month, periodStart: `2026-${String(month).padStart(2, '0')}-05`, validationStatus: 'VALID', consumption: value }))),
    forecasts: predictions.map((value, index) => ({ id: index + 1, unitId: index + 1, basedOnPeriodId: 5, forecastForMonth: '2026-11-01', status: 'READY', predictedConsumption: value })),
  };
}

for (const [prediction, expected] of [[11.5, 'INCREASE'], [8.5, 'DECREASE'], [11.499, 'STABLE'], [8.501, 'STABLE'], [10, 'STABLE']]) {
  test(`trend ${prediction} / 10 uses the 15% boundaries (${expected})`, () => {
    const result = buildAdminWaterGuidance(fixture([10], [prediction]));
    assert.equal(result.comparison.direction, expected);
    assert.equal(result.comparison.actualWaterCharge, 230);
    assert.equal(result.comparison.projectedWaterCharge, Math.round(prediction * 23 * 100) / 100);
    assert.equal(result.sourceMonth, '2026-10-01');
    assert.equal(result.forecastMonth, '2026-11-01');
    assert.equal(result.recommendations.length, expected === 'INCREASE' ? 3 : 2);
  });
}

test('partial coverage compares the same units, without treating missing forecasts as zero', () => {
  const f = fixture([10, 100], [12]);
  const result = buildAdminWaterGuidance(f);
  assert.equal(result.coverage.totalUnits, 2);
  assert.equal(result.coverage.readyUnits, 1);
  assert.equal(result.coverage.missingForecastUnits, 1);
  assert.equal(result.comparison.actualConsumption, 10);
  assert.equal(result.comparison.changePercent, 20);
  assert.match(result.recommendations.at(-1).action, /does not represent every unit/);
});

test('declining aggregate retains distinct inspection priorities with overlapping categories', () => {
  const f = fixture([10, 100, 20], [13, 50, 25]);
  f.units[0].occupancyStatus = 'VACANT';
  f.history.find(row => row.unitId === 3 && row.billingPeriodId === 5).validationStatus = 'FLAGGED';
  f.forecasts[2].status = 'FLAGGED_READING';
  const result = buildAdminWaterGuidance(f);
  assert.equal(result.comparison.direction, 'DECREASE');
  assert.equal(result.inspections.unitCount, 2);
  assert.equal(result.inspections.highUsageUnits, 1);
  assert.equal(result.inspections.vacantUsageUnits, 1);
  assert.equal(result.inspections.flaggedReadingUnits, 1);
  assert.equal(result.recommendations.find(row => row.key === 'INSPECTIONS').priority, 'HIGH');
  assert.ok(result.recommendations.every(row => !/PAYMENT|REMINDER|MONITOR_USAGE/.test(row.key)));
});

test('deduplicates units, forecasts, and monthly history while rejecting wrong origins and future readings', () => {
  const f = fixture();
  f.units.push(f.units[0]);
  f.forecasts.push({ ...f.forecasts[0] }, { ...f.forecasts[0], id: 99, basedOnPeriodId: 999, predictedConsumption: 999 }, { ...f.forecasts[0], id: 100, forecastForMonth: '2026-12-01', predictedConsumption: 999 });
  f.history.push({ ...f.history[0] }, { ...f.history[2], billingPeriodId: 4, consumption: 900 }, { ...f.history[2], billingPeriodId: 99, periodStart: '2026-11-05', consumption: 999 });
  const result = buildAdminWaterGuidance(f);
  assert.equal(result.coverage.totalUnits, 1);
  assert.equal(result.coverage.comparableUnits, 1);
  assert.equal(result.comparison.actualConsumption, 10);
  assert.equal(result.comparison.projectedConsumption, 12);
  assert.equal(result.inspections.highUsageUnits, 1);
});

test('a ready forecast requires actuals from its exact source period', () => {
  const f = fixture();
  f.history[2].billingPeriodId = 99;
  const result = buildAdminWaterGuidance(f);
  assert.equal(result.coverage.readyUnits, 1);
  assert.equal(result.coverage.comparableUnits, 0);
  assert.equal(result.coverage.missingActualUnits, 1);
  assert.equal(result.comparison.changePercent, null);
  assert.equal(result.inspections.unitCount, 0);
});

for (const prediction of [null, '', -1, 'bad', Infinity, false]) {
  test(`invalid ready prediction (${String(prediction)}) is not usable coverage`, () => {
    const result = buildAdminWaterGuidance(fixture([10], [prediction]));
    assert.equal(result.coverage.readyUnits, 0);
    assert.equal(result.coverage.invalidForecastUnits, 1);
    assert.equal(result.comparison.changePercent, null);
  });
}

test('zero baseline preserves totals without a percentage or a decrease assertion', () => {
  const result = buildAdminWaterGuidance(fixture([0], [2]));
  assert.equal(result.comparison.actualConsumption, 0);
  assert.equal(result.comparison.projectedConsumption, 2);
  assert.equal(result.comparison.changePercent, null);
  assert.equal(result.comparison.direction, 'UNAVAILABLE');
  assert.match(result.recommendations[0].action, /verify source readings/);
});

test('no forecasts, invalid readings, and missing rates have explicit unavailable values', () => {
  const f = fixture();
  f.forecasts = [];
  const missing = buildAdminWaterGuidance(f);
  assert.equal(missing.status, 'NO_COMPARISON');
  assert.equal(missing.coverage.missingForecastUnits, 1);
  assert.equal(missing.comparison.actualConsumption, null);
  f.forecasts = fixture().forecasts;
  f.source = { ...source, waterRate: null };
  assert.equal(buildAdminWaterGuidance(f).comparison.projectedWaterCharge, null);
  f.history[2].consumption = -1;
  assert.equal(buildAdminWaterGuidance(f).coverage.comparableUnits, 0);
  assert.equal(buildAdminWaterGuidance().status, 'NO_DATA');
  assert.equal(buildAdminWaterGuidance({ units: f.units }).coverage.missingForecastUnits, 1);
});

test('missing forecasts still allow current vacant-unit checks without diagnosing stale readings', () => {
  const f = fixture();
  f.forecasts = [];
  f.units[0].occupancyStatus = 'VACANT';
  assert.equal(buildAdminWaterGuidance(f).inspections.vacantUsageUnits, 1);
  f.history.pop();
  assert.equal(buildAdminWaterGuidance(f).inspections.vacantUsageUnits, 0);
});

test('coverage counts classify insufficient, flagged, missing and unusable forecasts', () => {
  const f = fixture([10, 20, 30, 40, 50], [12, 25, 35, 45]);
  f.forecasts[1].status = 'INSUFFICIENT_DATA';
  f.forecasts[2].status = 'FLAGGED_READING';
  f.forecasts[3].status = 'OTHER';
  const result = buildAdminWaterGuidance(f);
  assert.deepEqual([result.coverage.readyUnits, result.coverage.insufficientHistoryUnits, result.coverage.flaggedUnits, result.coverage.invalidForecastUnits, result.coverage.missingForecastUnits], [1, 1, 1, 1, 1]);
});

test('loader uses only reads, latest visible source and exact next-month forecast', async () => {
  const f = fixture(), calls = [];
  const client = { async query(sql, values) {
    assert.match(sql.trim(), /^SELECT/);
    calls.push([sql, values]);
    return { rows: sql.includes('FROM billing_periods p') ? [source] : sql.includes('FROM units') ? f.units : f.forecasts };
  } };
  const result = await loadAdminWaterGuidance(client, f.history);
  assert.match(calls[0][0], /HISTORICAL_ANALYTICS.*readings_visible_at/s);
  assert.match(calls[0][0], /ORDER BY p.period_start DESC, p.id DESC LIMIT 1/);
  assert.deepEqual(calls[2][1], [5, '2026-11-01']);
  assert.equal(result.comparison.changePercent, 20);
});

test('chart recommendations prescribe distinct consumption and billing actions', () => {
  const f = fixture([10, 100, 20], [13, 50]);
  f.units[1].occupancyStatus = 'VACANT';
  const { chartInsights } = buildAdminWaterGuidance(f);
  const usage = JSON.stringify(chartInsights.consumption), bills = JSON.stringify(chartInsights.bill);
  assert.match(usage, /47 m³/); assert.match(usage, /USAGE_INSPECTIONS/); assert.match(usage, /vacant/);
  assert.ok(!usage.includes('₱'));
  assert.match(bills, /₱1,081.00/); assert.match(bills, /₱2,530.00/); assert.match(bills, /₱1,449.00/);
  assert.match(bills, /approved water rate/); assert.match(bills, /2 of 3 units/);
  assert.ok(!/vacant|leak|Forecast consumption|meter-reading schedule/.test(bills));
  assert.deepEqual(chartInsights.bill.map(item => item.key), ['BILLING_CHANGE', 'BILLING_RATE', 'BILLING_COVERAGE']);
  assert.equal(chartInsights.bill.some(item => chartInsights.consumption.some(other => other.title === item.title || other.action === item.action)), false);
});

for (const [prediction, wording] of [[12, '₱46.00 increase'], [8, '₱46.00 decrease'], [10, 'Reconcile the next water-charge total']]) {
  test(`water-charge insight expresses the actual peso change (${wording})`, () => {
    const result = buildAdminWaterGuidance(fixture([10], [prediction]));
    const recommendation = result.chartInsights.bill.find(item => item.key === 'BILLING_CHANGE');
    assert.ok(recommendation.title.includes(wording));
    assert.match(recommendation.action, /provisional water-charge estimate/);
    assert.ok(!recommendation.condition.includes('consumption'));
    assert.equal(result.chartInsights.bill.some(item => item.key === 'BILLING_COVERAGE'), false);
  });
}

test('zero baseline uses peso difference without inventing a percentage change', () => {
  const result = buildAdminWaterGuidance(fixture([0], [2]));
  assert.match(result.chartInsights.bill[0].title, /₱46.00 increase/);
  assert.ok(!JSON.stringify(result.chartInsights.bill).includes('%'));
  assert.match(result.chartInsights.consumption[0].condition, /2 m³/);
  assert.match(result.chartInsights.consumption[0].condition, /baseline is zero/);
});

test('invalid water rate blocks billing guidance while preserving consumption advice', () => {
  const f = fixture([10], [12]); f.source = { ...source, waterRate: 0 };
  const result = buildAdminWaterGuidance(f);
  assert.equal(result.chartInsights.bill.length, 1);
  assert.equal(result.chartInsights.bill[0].key, 'BILLING_RATE');
  assert.match(result.chartInsights.bill[0].title, /Set a valid water rate/);
  assert.ok(!JSON.stringify(result.chartInsights.bill).includes('₱0.00'));
  assert.match(result.chartInsights.consumption[0].condition, /2 m³/);
});

test('absent data produces graph-specific input actions, without fabricated totals', () => {
  const empty = buildAdminWaterGuidance();
  assert.equal(empty.chartInsights.consumption[0].key, 'USAGE_HISTORY');
  assert.equal(empty.chartInsights.bill[0].key, 'BILLING_INPUTS');
  const f = fixture(); f.forecasts = [];
  const noForecasts = buildAdminWaterGuidance(f);
  assert.equal(noForecasts.chartInsights.bill[0].key, 'BILLING_DATA');
  assert.match(noForecasts.chartInsights.bill[0].action, /billing readings/);
  assert.ok(!JSON.stringify(noForecasts.chartInsights.bill).includes('₱0.00'));
});
