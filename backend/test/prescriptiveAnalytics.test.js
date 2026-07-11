import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPrescriptiveRecommendations, RECOMMENDATION_TYPES } from '../services/prescriptiveAnalytics.js';

function reading(month, consumption, validationStatus = 'VALID') {
  return {
    periodStart: `2026-${String(month).padStart(2, '0')}-01`,
    consumption,
    validationStatus,
    validationNotes: validationStatus === 'FLAGGED' ? 'Reading continuity needs review.' : null,
  };
}

test('recommends reviewing a flagged latest meter reading', () => {
  const recommendations = buildPrescriptiveRecommendations({
    forecast: { status: 'FLAGGED_READING', reason: 'The latest meter reading requires review.', sampleCount: 0 },
    history: [reading(1, 10), reading(2, 12, 'FLAGGED')],
  });
  assert.equal(recommendations.length, 1);
  assert.equal(recommendations[0].recommendationType, RECOMMENDATION_TYPES.REVIEW_METER_READING);
  assert.equal(recommendations[0].priority, 'HIGH');
});

test('recommends collecting only the missing number of valid readings', () => {
  const recommendations = buildPrescriptiveRecommendations({
    forecast: { status: 'INSUFFICIENT_DATA', sampleCount: 2 },
    history: [reading(1, 10), reading(2, 11)],
  });
  assert.equal(recommendations[0].recommendationType, RECOMMENDATION_TYPES.COLLECT_MORE_HISTORY);
  assert.equal(recommendations[0].evidence.missingMonths, 3);
});

test('flags projected consumption exactly 30 percent above the recent average', () => {
  const history = [reading(1, 10), reading(2, 10), reading(3, 10), reading(4, 10), reading(5, 10)];
  const recommendations = buildPrescriptiveRecommendations({
    forecast: { status: 'READY', sampleCount: 5, predictedConsumption: 13 },
    history,
  });
  assert.equal(recommendations.length, 1);
  assert.equal(recommendations[0].recommendationType, RECOMMENDATION_TYPES.CHECK_HIGH_USAGE);
  assert.equal(recommendations[0].evidence.increasePercent, 30);
});

test('does not flag a normal or below-threshold forecast', () => {
  const history = [reading(1, 10), reading(2, 10), reading(3, 10), reading(4, 10), reading(5, 10)];
  const recommendations = buildPrescriptiveRecommendations({
    forecast: { status: 'READY', sampleCount: 5, predictedConsumption: 12.999 },
    history,
  });
  assert.deepEqual(recommendations, []);
});
