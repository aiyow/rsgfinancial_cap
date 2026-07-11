import assert from "node:assert/strict";
import test from "node:test";
import {
  buildForecast,
  calculateAccuracy,
  linearRegression,
  selectConsecutiveReadings,
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
