import assert from 'node:assert/strict';
import test from 'node:test';
import { benchmarkDataset, summarizeEvaluationHistory, evaluationBaselines, validEvaluationPair } from '../services/forecastEvaluation.js';

const history = Array.from({ length: 9 }, (_, i) => ({ unitId: 1, unitNumber: '101',
  periodStart: `2026-${String(i + 1).padStart(2, '0')}-01`, consumption: 10, validationStatus: 'VALID' }));

test('monthly model and baseline scores use identical eligible pairs and count exclusions', () => {
  const rows = [
    { unitId: 1, forecastForMonth: '2026-08-01', basedOnPeriodStart: '2026-07-01', status: 'READY', actualValidationStatus: 'VALID', predictedConsumption: 12, actualConsumption: 10 },
    { unitId: 2, forecastForMonth: '2026-08-01', basedOnPeriodStart: '2026-07-01', status: 'READY', actualValidationStatus: 'FLAGGED', predictedConsumption: 2, actualConsumption: 3 },
    { unitId: 3, forecastForMonth: '2026-08-01', basedOnPeriodStart: '2026-07-01', status: 'READY', actualValidationStatus: 'VALID', predictedConsumption: null, actualConsumption: 3 },
  ];
  const summary = summarizeEvaluationHistory(rows, history)[0];
  assert.equal(summary.metrics.evaluatedCount, 1);
  assert.equal(summary.metrics.excludedCount, 2);
  assert.equal(summary.metrics.wape, 20);
  assert.equal(summary.baselines.lastMonth.evaluatedCount, 1);
  assert.equal(summary.baselines.recentAverage.evaluatedCount, 1);
  assert.equal(summary.baselines.lastMonth.wape, 0);
});

test('baseline construction cannot read the evaluated month', () => {
  const changed = history.map((row, i) => i >= 7 ? { ...row, consumption: 9999 } : row);
  assert.deepEqual(evaluationBaselines(changed, '2026-07-01'), { lastMonth: 10, recentAverage: 10 });
  assert.equal(validEvaluationPair({ status: 'READY', actualValidationStatus: 'VALID', predictedConsumption: ' ', actualConsumption: 1 }), false);
});

test('benchmark gate does not promote equal policies or invent an evaluated future month', () => {
  const dataset = { readings: history, units: [{ unitId: 1, unitNumber: '101' }],
    periods: history.map((row, i) => ({ id: i + 1, periodStart: row.periodStart })) };
  const report = benchmarkDataset(dataset);
  assert.equal(report.aggregate.current.evaluatedCount, 4);
  assert.equal(report.aggregate.revised.evaluatedCount, 4);
  assert.equal(report.aggregate.current.mae, 0);
  assert.equal(report.acceptance.passed, false);
  assert.equal(report.latest.forecastForMonth, '2026-09-01');
  assert.ok(report.pairs.every((row) => row.sourceMonth < row.forecastForMonth));
});
