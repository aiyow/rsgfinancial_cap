import assert from "node:assert/strict";
import test from "node:test";
import {
  buildForecast,
  calculateAccuracy,
  forecastCandidates,
  linearRegression,
  selectForecastModel,
  selectStableForecastModel,
  selectConsecutiveReadings,
  weightedLinearRegression,
  regenerateForecasts,
} from "../services/predictiveAnalytics.js";

function reading(month, consumption, validationStatus = "VALID") {
  return { periodStart: `2026-${String(month).padStart(2, "0")}-01`, consumption, validationStatus };
}

test("linear regression predicts the next point", () => {
  const result = linearRegression([2, 4, 6, 8, 10]);
  assert.equal(result.slope, 2);
  assert.equal(result.intercept, 2);
  assert.equal(result.predicted, 12);
});

test("linear regression clamps a negative prediction to zero", () => {
  assert.equal(linearRegression([10, 7, 4, 1, 0]).predicted, 0);
});

test("adaptive selection retains linear regression for a small, clear trend", () => {
  const model = selectForecastModel([2, 4, 6, 8, 10]);
  assert.equal(model.name, "LINEAR_REGRESSION");
  assert.equal(model.predicted, 12);
});

test("adaptive selection can choose a stable model after back-testing irregular use", () => {
  const values = [10, 10, 10, 10, 10, 30, 10, 10];
  const models = forecastCandidates(values);
  assert.equal(models.length, 6);
  assert.equal(selectForecastModel(values).name, "RECENT_5_MONTH_MEDIAN");
});

test('weighted regression preserves an exact trend and clamps negative predictions', () => {
  assert.ok(Math.abs(weightedLinearRegression([2, 4, 6, 8, 10]).predicted - 12) < 1e-9);
  assert.equal(weightedLinearRegression([10, 7, 4, 1, 0]).predicted, 0);
});

test('requires two internal comparison months and breaks ties in favor of last-month', () => {
  assert.equal(selectForecastModel([10, 10, 10, 10, 10, 10]).name, 'LINEAR_REGRESSION');
  assert.equal(selectForecastModel([10, 10, 10, 10, 10, 10, 10]).name, 'LAST_MONTH_CONSUMPTION');
});

test('stable policy preserves warm-up regression and exact increasing or decreasing trends', () => {
  assert.equal(selectStableForecastModel([1, 3, 2, 4, 3, 5]).name, 'LINEAR_REGRESSION');
  assert.equal(selectStableForecastModel([2, 4, 6, 8, 10, 12, 14]).predicted, 16);
  assert.equal(selectStableForecastModel([7, 6, 5, 4, 3, 2, 1]).predicted, 0);
});

test('stable policy moderates spikes, stays within recent component forecasts, and handles numeric strings', () => {
  const values = [10, 10, 10, 10, 10, 30, 10, 10];
  const model = selectStableForecastModel(values);
  assert.equal(model.name, 'STABLE_RECENT_ENSEMBLE');
  assert.ok(model.predicted > 10 && model.predicted < 13);
  assert.deepEqual(selectStableForecastModel(values.map(String)), model);
  assert.equal(selectStableForecastModel([0, 0, 0, 0, 0, 0, 0]).predicted, 0);
  assert.ok(selectStableForecastModel([0, 0, 0, 0, 0, 10, 10, 10]).predicted > 8);
  assert.equal(selectStableForecastModel([1, 2, 3, null, 5, 6, 7]), null);
});

test('PostgreSQL numeric strings produce the same candidates and selected method as numbers', () => {
  const values = [1.2, 3.4, 5.6, 7.8, 9.1, 11.2, 13.4, 15.6];
  assert.deepEqual(forecastCandidates(values.map(String)), forecastCandidates(values));
  assert.deepEqual(selectForecastModel(values.map(String)), selectForecastModel(values));
});

test('missing values are rejected while real zero consumption is retained', () => {
  for (const missing of [null, undefined, '', '  ', NaN, Infinity, false]) {
    assert.equal(linearRegression([1, 2, missing, 4, 5]), null);
    assert.equal(forecastCandidates([1, 2, missing, 4, 5]).length, 0);
    assert.equal(calculateAccuracy([{ predictedConsumption: missing, actualConsumption: 10 }]).evaluatedCount, 0);
    assert.equal(calculateAccuracy([{ predictedConsumption: 10, actualConsumption: missing }]).evaluatedCount, 0);
  }
  const result = buildForecast(Array.from({ length: 8 }, (_, i) => reading(i + 1, 0)));
  assert.equal(result.status, 'READY');
  assert.equal(result.predictedConsumption, 0);
  const metrics = calculateAccuracy([{ predictedConsumption: 2, actualConsumption: 0 }]);
  assert.equal(metrics.mae, 2);
  assert.equal(metrics.wape, null);
  assert.equal(metrics.accuracy, null);
});

test('source month requires its own valid reading and ignores all future readings', () => {
  const history = Array.from({ length: 9 }, (_, i) => reading(i + 1, (i + 1) * 2));
  const august = buildForecast(history, { sourceMonth: '2026-07-01' });
  const changed = history.map((row, i) => i >= 7 ? { ...row, consumption: 5000 } : row);
  assert.deepEqual(buildForecast(changed, { sourceMonth: '2026-07-01' }), august);
  assert.equal(buildForecast(history.slice(0, 6), { sourceMonth: '2026-07-01' }).status, 'INSUFFICIENT_DATA');
  assert.equal(buildForecast([...history.slice(0, 6), reading(7, 3, 'FLAGGED')], { sourceMonth: '2026-07-01' }).status, 'FLAGGED_READING');
});

test('training never bridges missing or invalid months and uses at most twelve months', () => {
  const history = Array.from({ length: 14 }, (_, i) => ({
    periodStart: new Date(Date.UTC(2025, i, 1)).toISOString().slice(0, 10), consumption: i, validationStatus: 'VALID',
  }));
  assert.equal(buildForecast(history).sampleCount, 12);
  assert.equal(selectConsecutiveReadings(history.filter((_, i) => i !== 11)).length, 2);
  assert.equal(selectConsecutiveReadings([...history.slice(0, 13), { ...history[13], consumption: null }]).length, 0);
});

test('adapts to a sustained usage change without losing real zero readings', () => {
  const model = selectForecastModel([0, 0, 0, 0, 0, 10, 10, 10]);
  assert.equal(model.name, 'LAST_MONTH_CONSUMPTION');
  assert.equal(model.predicted, 10);
});

test('accuracy excludes negative forecasts and reports an error above one hundred percent honestly', () => {
  const metrics = calculateAccuracy([{ predictedConsumption: -1, actualConsumption: 2 }, { predictedConsumption: 5, actualConsumption: 1 }]);
  assert.equal(metrics.evaluatedCount, 1);
  assert.equal(metrics.wape, 400);
  assert.equal(metrics.accuracy, 0);
});

test('persisted generation filters training visibility and marks units missing the source month insufficient', async () => {
  const queries = [];
  const client = { async query(sql, params) {
    queries.push({ sql, params });
    if (sql.startsWith('SELECT id, period_start')) return { rows: [{ id: 8, periodStart: '2026-08-01', waterRate: 23 }] };
    if (sql.includes('FROM meter_readings')) return { rows: Array.from({ length: 7 }, (_, i) => ({ ...reading(i + 1, 10), unitId: 1 })) };
    if (sql === 'SELECT id FROM units ORDER BY id') return { rows: [{ id: 1 }] };
    return { rows: [] };
  } };
  await regenerateForecasts(client, 8);
  assert.match(queries.find((row) => row.sql.includes('FROM meter_readings')).sql, /FORWARDED.*CLOSED/);
  assert.match(queries.find((row) => row.sql.includes('FROM meter_readings')).sql, /readings_visible_at IS NOT NULL/);
  const insert = queries.find((row) => row.sql.includes('INSERT INTO billing_forecasts'));
  assert.equal(insert.params[2], '2026-09-01');
  assert.equal(insert.params[3], null);
  assert.equal(insert.params[9], 'INSUFFICIENT_DATA');
});

test("only the latest consecutive valid segment is selected", () => {
  const history = [
    reading(1, 2), reading(2, 3, "FLAGGED"), reading(3, 4),
    reading(4, 5), reading(5, 6), reading(6, 7), reading(7, 8),
  ];
  assert.deepEqual(selectConsecutiveReadings(history).map((row) => row.consumption), [4, 5, 6, 7, 8]);
  assert.equal(selectConsecutiveReadings([...history, reading(9, 9)]).length, 1);
});

test("forecast requires five consecutive valid readings", () => {
  const insufficient = buildForecast([reading(1, 1), reading(2, 2), reading(3, 3), reading(4, 4)]);
  assert.equal(insufficient.status, "INSUFFICIENT_DATA");
  const ready = buildForecast([reading(1, 1), reading(2, 2), reading(3, 3), reading(4, 4), reading(5, 5)], { waterRate: 23 });
  assert.equal(ready.status, "READY");
  assert.equal(ready.predictedConsumption, 6);
  assert.equal(ready.estimatedWaterCharge, 138);
});

test("a flagged latest reading prevents a forecast", () => {
  const result = buildForecast([reading(1, 1), reading(2, 2), reading(3, 3), reading(4, 4), reading(5, 5, "FLAGGED")]);
  assert.equal(result.status, "FLAGGED_READING");
});

test("accuracy reports MAE, RMSE, WAPE, and bounded accuracy", () => {
  const result = calculateAccuracy([
    { predictedConsumption: 8, actualConsumption: 10 },
    { predictedConsumption: 4, actualConsumption: 5 },
  ]);
  assert.equal(result.evaluatedCount, 2);
  assert.equal(result.mae, 1.5);
  assert.equal(result.wape, 20);
  assert.equal(result.accuracy, 80);
});
