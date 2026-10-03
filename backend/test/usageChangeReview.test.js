import assert from 'node:assert/strict';
import test from 'node:test';
import { detectUsageChange } from '../services/usageChangeReview.js';
import { summarizeEvaluationHistory } from '../services/forecastEvaluation.js';

const sourceMonth = '2026-08-01';
const makeHistory = (values, unitId = 1) => values.map((consumption, index) => ({
  unitId, unitNumber: String(unitId), periodStart: `2026-${String(index + 1).padStart(2, '0')}-01`, consumption, validationStatus: 'VALID',
}));
const steady = makeHistory(Array(8).fill(10));
const pair = (unitId, actualConsumption, predictedConsumption) => ({
  unitId, unitNumber: String(unitId), forecastForMonth: '2026-09-01', basedOnPeriodStart: sourceMonth,
  status: 'READY', actualValidationStatus: 'VALID', actualConsumption, predictedConsumption,
});

test('fixed historical usage limits identify both spikes and large drops', () => {
  const spike = detectUsageChange(steady, sourceMonth, '30');
  assert.equal(spike.type, 'USAGE_SPIKE');
  assert.equal(spike.usualConsumption, 10);
  assert.equal(spike.changeThreshold, 7.5);
  assert.equal(spike.change, 20);
  assert.equal(detectUsageChange(steady, sourceMonth, 1).type, 'USAGE_DROP');
  assert.equal(detectUsageChange(steady, sourceMonth, 17.5), null);
});

test('absolute minimum change avoids treating tiny near-zero differences as spikes', () => {
  const zeroHistory = makeHistory(Array(8).fill(0));
  assert.equal(detectUsageChange(zeroHistory, sourceMonth, 3), null);
  assert.equal(detectUsageChange(zeroHistory, sourceMonth, 3.001).type, 'USAGE_SPIKE');
});

test('recurring zero usage remains typical while a new zero after regular use prompts review', () => {
  assert.equal(detectUsageChange(steady, sourceMonth, 0).type, 'ZERO_AFTER_REGULAR_USE');
  assert.equal(detectUsageChange(makeHistory(Array(8).fill(0)), sourceMonth, 0), null);
  assert.equal(detectUsageChange(makeHistory([10, 10, 10, 10, 10, 10, 0, 10]), sourceMonth, 0), null);
  assert.equal(detectUsageChange(makeHistory(Array(8).fill(0.2)), sourceMonth, 0), null);
});

test('variable histories and ordinary linear trends widen the review band', () => {
  assert.equal(detectUsageChange(makeHistory([10, 10, 10, 4, 7, 10, 13, 16]), sourceMonth, 18), null);
  assert.equal(detectUsageChange(makeHistory([2, 4, 6, 8, 10, 12, 14, 16]), sourceMonth, 18), null);
});

test('review windows never cross invalid or missing readings and require the source month', () => {
  assert.equal(detectUsageChange(steady.slice(0, 7), sourceMonth, 30), null);
  assert.equal(detectUsageChange(steady.filter((_, index) => index !== 5), sourceMonth, 30), null);
  for (const invalid of [null, undefined, '', ' ', false, Infinity, NaN, -1]) {
    assert.equal(detectUsageChange(steady, sourceMonth, invalid), null);
    assert.equal(detectUsageChange(steady.map((row, index) => index === 6 ? { ...row, consumption: invalid } : row), sourceMonth, 30), null);
  }
  assert.equal(detectUsageChange(steady.map((row, index) => index === 6 ? { ...row, validationStatus: 'FLAGGED' } : row), sourceMonth, 30), null);
});

test('review baselines cannot read the evaluated or future months', () => {
  const later = [...steady, { ...steady[0], periodStart: '2026-09-05', consumption: 9999 },
    { ...steady[0], periodStart: '2026-10-05', consumption: 0 }];
  assert.deepEqual(detectUsageChange(later, sourceMonth, 30), detectUsageChange(steady, sourceMonth, 30));
});

test('secondary metrics partition valid pairs by usage changes, not prediction errors', () => {
  const readings = [1, 2, 3, 4].flatMap((unitId) => makeHistory(Array(8).fill(10), unitId));
  const rows = [pair(1, 30, 30), pair(2, 10, 100), pair(3, 0, 5), { ...pair(4, 10, 500), actualValidationStatus: 'FLAGGED' }];
  const summary = summarizeEvaluationHistory(rows, readings)[0];
  const review = summary.usageReview;
  assert.equal(summary.metrics.evaluatedCount, 3);
  assert.equal(summary.metrics.excludedCount, 1);
  assert.deepEqual(summary.totals, { actualConsumption: 40, absoluteError: 95 });
  assert.equal(review.alertCount, 2);
  assert.equal(review.typicalMetrics.evaluatedCount, 1);
  assert.equal(review.typicalMetrics.wape, 900);
  assert.equal(review.typicalBaselines.lastMonth.evaluatedCount, 1);
  assert.equal(review.typicalBaselines.recentAverage.evaluatedCount, 1);
  assert.equal(review.alertErrorShare, 5.26);
  assert.equal(review.alerts[0].unitId, 3);
  assert.equal(review.alerts.find((row) => row.unitId === 1).absoluteError, 0);
  assert.deepEqual(review.typicalTotals, { actualConsumption: 10, absoluteError: 90 });
  assert.deepEqual(review.alertTotals, { actualConsumption: 30, absoluteError: 5 });
});

test('secondary scores remain unavailable for empty subsets and zero actual totals', () => {
  const allAlerts = summarizeEvaluationHistory([pair(1, 30, 25)], steady)[0];
  assert.equal(allAlerts.usageReview.typicalMetrics.evaluatedCount, 0);
  assert.equal(allAlerts.usageReview.typicalMetrics.accuracy, null);
  const zero = summarizeEvaluationHistory([pair(1, 0, 2)], makeHistory(Array(8).fill(0)))[0];
  assert.equal(zero.usageReview.alertCount, 0);
  assert.equal(zero.usageReview.typicalMetrics.evaluatedCount, 1);
  assert.equal(zero.usageReview.typicalMetrics.wape, null);
  assert.equal(zero.usageReview.typicalMetrics.accuracy, null);
});
