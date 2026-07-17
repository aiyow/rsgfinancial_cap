import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPrescriptiveRecommendations,
  isResidentVisibleRecommendation,
  RECOMMENDATION_TYPES,
} from '../services/prescriptiveAnalytics.js';

function reading(month, consumption, validationStatus = 'VALID') {
  return {
    periodStart: `2026-${String(month).padStart(2, '0')}-01`,
    consumption,
    validationStatus,
    validationNotes: validationStatus === 'FLAGGED' ? 'Reading continuity needs review.' : null,
  };
}

function types(result) {
  return result.map((item) => item.recommendationType);
}

test('recommends a meter recheck for a flagged latest reading', () => {
  const recommendations = buildPrescriptiveRecommendations({
    forecast: { status: 'FLAGGED_READING', reason: 'The latest meter reading requires review.' },
    history: [reading(1, 10), reading(2, 12, 'FLAGGED')],
  });
  assert.deepEqual(types(recommendations), [RECOMMENDATION_TYPES.REVIEW_METER_READING]);
  assert.match(recommendations[0].message, /meter photo/i);
});

test('keeps the staff-only insufficient-history recommendation', () => {
  const recommendations = buildPrescriptiveRecommendations({
    forecast: { status: 'INSUFFICIENT_DATA', sampleCount: 2 },
    history: [reading(1, 10), reading(2, 11)],
  });
  assert.equal(recommendations[0].recommendationType, RECOMMENDATION_TYPES.COLLECT_MORE_HISTORY);
  assert.equal(recommendations[0].evidence.missingMonths, 3);
});

test('flags a forecast exactly 15 percent above the three-month average', () => {
  const recommendations = buildPrescriptiveRecommendations({
    forecast: { status: 'READY', predictedConsumption: 11.5 },
    history: [reading(1, 10), reading(2, 10), reading(3, 10)],
  });
  assert.ok(types(recommendations).includes(RECOMMENDATION_TYPES.CHECK_HIGH_USAGE));
});

test('does not flag a forecast just below the 15 percent threshold', () => {
  const recommendations = buildPrescriptiveRecommendations({
    forecast: { status: 'READY', predictedConsumption: 11.499 },
    history: [reading(1, 10), reading(2, 10), reading(3, 10)],
  });
  assert.ok(!types(recommendations).includes(RECOMMENDATION_TYPES.CHECK_HIGH_USAGE));
});

test('suppresses high-usage percentages when the recent baseline is mostly zero', () => {
  const recommendations = buildPrescriptiveRecommendations({
    forecast: { status: 'READY', predictedConsumption: 0.065 },
    history: [reading(1, 0), reading(2, 0), reading(3, 0.081)],
  });
  const monitoring = recommendations.find((item) => item.recommendationType === RECOMMENDATION_TYPES.MONITOR_USAGE);
  assert.ok(!types(recommendations).includes(RECOMMENDATION_TYPES.CHECK_HIGH_USAGE));
  assert.ok(monitoring);
  assert.equal(monitoring.evidence.positiveBaselineCount, 1);
  assert.equal(monitoring.evidence.zeroReadingCount, 2);
  assert.equal(monitoring.evidence.baselineMethod, 'POSITIVE_READINGS_ONLY');
  assert.equal(monitoring.evidence.increasePercent, undefined);
});

test('uses only positive readings after two positive baseline readings exist', () => {
  const recommendations = buildPrescriptiveRecommendations({
    forecast: { status: 'READY', predictedConsumption: 4 },
    history: [reading(1, 0), reading(2, 2), reading(3, 4)],
  });
  const highUsage = recommendations.find((item) => item.recommendationType === RECOMMENDATION_TYPES.CHECK_HIGH_USAGE);
  assert.ok(highUsage);
  assert.equal(highUsage.evidence.recentAverage, 3);
  assert.equal(highUsage.evidence.positiveBaselineCount, 2);
  assert.equal(highUsage.evidence.zeroReadingCount, 1);
  assert.equal(highUsage.evidence.baselineMethod, 'POSITIVE_READINGS_ONLY');
});

test('encourages early monitoring when a forecast is near the recent high', () => {
  const recommendations = buildPrescriptiveRecommendations({
    forecast: { status: 'READY', predictedConsumption: 9.5 },
    history: [reading(1, 8), reading(2, 9), reading(3, 10)],
  });
  assert.ok(types(recommendations).includes(RECOMMENDATION_TYPES.MONITOR_HIGH_USAGE));
  assert.ok(!types(recommendations).includes(RECOMMENDATION_TYPES.CHECK_HIGH_USAGE));
});

test('creates a resident monitoring insight when no warning threshold is active', () => {
  const recommendations = buildPrescriptiveRecommendations({
    forecast: { status: 'READY', predictedConsumption: 7 },
    history: [reading(1, 8), reading(2, 8), reading(3, 8)],
  });
  const monitoring = recommendations.find((item) => item.recommendationType === RECOMMENDATION_TYPES.MONITOR_USAGE);
  assert.ok(monitoring);
  assert.equal(isResidentVisibleRecommendation(RECOMMENDATION_TYPES.MONITOR_USAGE), true);
  assert.match(monitoring.message, /within the monitoring thresholds/i);
});

test('flags vacant units only above one cubic meter', () => {
  const atThreshold = buildPrescriptiveRecommendations({
    forecast: { status: 'READY', predictedConsumption: 5 },
    history: [reading(1, 1), reading(2, 1), reading(3, 1)],
    context: { occupancyStatus: 'VACANT' },
  });
  const aboveThreshold = buildPrescriptiveRecommendations({
    forecast: { status: 'READY', predictedConsumption: 5 },
    history: [reading(1, 1), reading(2, 1), reading(3, 1.001)],
    context: { occupancyStatus: 'VACANT' },
  });
  assert.ok(!types(atThreshold).includes(RECOMMENDATION_TYPES.VACANT_UNIT_USAGE));
  assert.ok(types(aboveThreshold).includes(RECOMMENDATION_TYPES.VACANT_UNIT_USAGE));
});

test('detects exactly three rising consecutive valid readings', () => {
  const rising = buildPrescriptiveRecommendations({
    forecast: { status: 'READY', predictedConsumption: 13 },
    history: [reading(1, 8), reading(2, 9), reading(3, 10)],
  });
  const interrupted = buildPrescriptiveRecommendations({
    forecast: { status: 'READY', predictedConsumption: 13 },
    history: [reading(1, 8), reading(2, 9, 'FLAGGED'), reading(3, 10)],
  });
  assert.ok(types(rising).includes(RECOMMENDATION_TYPES.RISING_CONSUMPTION));
  assert.ok(!types(interrupted).includes(RECOMMENDATION_TYPES.RISING_CONSUMPTION));
});

test('creates payment reminders only for unpaid balances due within five days', () => {
  const base = {
    forecast: { status: 'READY', predictedConsumption: 8 },
    history: [reading(1, 8), reading(2, 8), reading(3, 8)],
  };
  const today = new Date('2026-06-10T12:00:00Z');
  const dueInFiveDays = buildPrescriptiveRecommendations({ ...base, context: { remainingBalance: 100, dueDate: '2026-06-15', today } });
  const dueInSixDays = buildPrescriptiveRecommendations({ ...base, context: { remainingBalance: 100, dueDate: '2026-06-16', today } });
  const overdue = buildPrescriptiveRecommendations({ ...base, context: { remainingBalance: 100, dueDate: '2026-06-09', today } });
  const paid = buildPrescriptiveRecommendations({ ...base, context: { remainingBalance: 0, dueDate: '2026-06-12', today } });
  assert.ok(types(dueInFiveDays).includes(RECOMMENDATION_TYPES.PAYMENT_REMINDER));
  assert.ok(!types(dueInSixDays).includes(RECOMMENDATION_TYPES.PAYMENT_REMINDER));
  assert.ok(!types(overdue).includes(RECOMMENDATION_TYPES.PAYMENT_REMINDER));
  assert.ok(!types(paid).includes(RECOMMENDATION_TYPES.PAYMENT_REMINDER));
});

test('exposes only resident-safe recommendation types', () => {
  assert.equal(isResidentVisibleRecommendation(RECOMMENDATION_TYPES.CHECK_HIGH_USAGE), true);
  assert.equal(isResidentVisibleRecommendation(RECOMMENDATION_TYPES.RISING_CONSUMPTION), true);
  assert.equal(isResidentVisibleRecommendation(RECOMMENDATION_TYPES.PAYMENT_REMINDER), true);
  assert.equal(isResidentVisibleRecommendation(RECOMMENDATION_TYPES.MONITOR_USAGE), true);
  assert.equal(isResidentVisibleRecommendation(RECOMMENDATION_TYPES.VACANT_UNIT_USAGE), false);
  assert.equal(isResidentVisibleRecommendation(RECOMMENDATION_TYPES.REVIEW_METER_READING), false);
});
