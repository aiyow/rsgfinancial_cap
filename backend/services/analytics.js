import { billAppliedSql, billTotalSql, chargePaymentsSql } from './payments.js';
import { writeAuditLog } from './audit.js';

// Analytics service. Fold the region sections to navigate related code.
// 1. Eligible analytics periods
// 2. Usage anomaly rules
// 3. Predictive models and forecasts
// 4. Actual usage change review
// 5. Prescriptive recommendations
// 6. Forecast evaluation and baselines
// 7. Forecast policy comparisons
// 8. Admin water guidance
// 9. Transactional forecast refresh

// #region Eligible analytics periods

// Shared visibility rule for training, evaluation, and forecast refresh.
export const analyticsPeriodCondition = (alias) => `(
  (${alias}.period_type = 'LIVE_BILLING' AND ${alias}.status IN ('FORWARDED', 'CLOSED'))
  OR (${alias}.period_type = 'HISTORICAL_ANALYTICS' AND ${alias}.readings_visible_at IS NOT NULL)
)`;

// #endregion

// #region Usage anomaly rules

// Pure anomaly calculations shared by model selection and actual-usage review.
// These calculations are pure and do not read forecast or database state.
export const usageReviewRule = {
  historyMonths: 5,
  minimumChange: 3,
  relativeChange: 0.75,
  deviationMultiplier: 3,
  zeroBaselineMinimum: 1,
  positiveMonthsBeforeZero: 3,
};

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function validNumber(value) {
  return value !== null && value !== undefined && typeof value !== 'boolean'
    && !(typeof value === 'string' && value.trim() === '') && Number.isFinite(Number(value)) && Number(value) >= 0;
}

export function classifyUsageChange(priorValues, actualConsumption) {
  if (!Array.isArray(priorValues) || priorValues.length !== usageReviewRule.historyMonths
    || priorValues.some((value) => !validNumber(value)) || !validNumber(actualConsumption)) return null;
  const values = priorValues.map(Number);
  const usualConsumption = median(values);
  const medianDeviation = median(values.map((value) => Math.abs(value - usualConsumption)));
  const changeThreshold = Math.max(usageReviewRule.minimumChange,
    usualConsumption * usageReviewRule.relativeChange, medianDeviation * usageReviewRule.deviationMultiplier);
  const actual = Number(actualConsumption);
  const change = actual - usualConsumption;
  const recent = values.slice(-usageReviewRule.positiveMonthsBeforeZero);
  // A zero already present in recent history is not a new shutdown pattern.
  if (actual === 0 && recent.some((value) => value === 0)) return null;
  const unexpectedZero = actual === 0 && usualConsumption >= usageReviewRule.zeroBaselineMinimum
    && recent.every((value) => value > 0);
  if (!unexpectedZero && Math.abs(change) <= changeThreshold) return null;
  return {
    type: unexpectedZero ? 'ZERO_AFTER_REGULAR_USE' : change > 0 ? 'USAGE_SPIKE' : 'USAGE_DROP',
    usualConsumption: Number(usualConsumption.toFixed(3)),
    actualConsumption: actual,
    change: Number(change.toFixed(3)),
    changeThreshold: Number(changeThreshold.toFixed(3)),
    priorMonthCount: values.length,
  };
}

// #endregion

// #region Predictive models and forecasts

// Keep model training bounded and preserve the five-reading eligibility rule.
const MIN_WINDOW_SIZE = 5;
const MAX_WINDOW_SIZE = 12;
const WINDOW_SIZE = MAX_WINDOW_SIZE;
// Regression is primary; recent qualifying spikes/zeros temporarily use the stable ensemble.
export const ACTIVE_FORECAST_POLICY = 'regression_first';

function numeric(value) {
  if (value === null || value === undefined || typeof value === 'boolean'
    || (typeof value === 'string' && value.trim() === '')) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

export function monthIndex(value) {
  const date = new Date(value);
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

export function nextMonthStart(value) {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

export function linearRegression(values) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const points = values.map((value, index) => ({ x: index, y: numeric(value) }));
  if (points.some((point) => point.y === null)) return null;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const denominator = points.reduce((sum, point) => sum + ((point.x - meanX) ** 2), 0);
  const slope = denominator === 0 ? 0 : points.reduce(
    (sum, point) => sum + ((point.x - meanX) * (point.y - meanY)),
    0,
  ) / denominator;
  const intercept = meanY - (slope * meanX);
  return { slope, intercept, predicted: Math.max(0, intercept + (slope * points.length)) };
}

export function weightedLinearRegression(values) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const points = values.map((value, x) => ({ x, y: numeric(value), weight: 2 ** (-(values.length - 1 - x) / 3) }));
  if (points.some((point) => point.y === null)) return null;
  const totalWeight = points.reduce((sum, p) => sum + p.weight, 0);
  const meanX = points.reduce((sum, p) => sum + p.weight * p.x, 0) / totalWeight;
  const meanY = points.reduce((sum, p) => sum + p.weight * p.y, 0) / totalWeight;
  const denominator = points.reduce((sum, p) => sum + p.weight * (p.x - meanX) ** 2, 0);
  const slope = denominator === 0 ? 0 : points.reduce((sum, p) => sum + p.weight * (p.x - meanX) * (p.y - meanY), 0) / denominator;
  const intercept = meanY - slope * meanX;
  return { slope, intercept, predicted: Math.max(0, intercept + slope * values.length) };
}

function recentValues(values, count) {
  return values.slice(Math.max(0, values.length - count));
}

function recentAverage(values, count = 3) {
  const sample = recentValues(values, count);
  if (sample.length === 0) return 0;
  return Math.max(0, sample.reduce((sum, value) => sum + value, 0) / sample.length);
}

// Water use is not always a straight line.  These candidates give the model a
// stable option for units with irregular use and a responsive option for units
// whose consumption has changed recently.
export function forecastCandidates(values) {
  if (!Array.isArray(values) || values.length < MIN_WINDOW_SIZE
    || values.some((value) => numeric(value) === null || numeric(value) < 0)) return [];
  values = values.map(numeric);
  const fullRegression = linearRegression(values);
  const recentRegression = linearRegression(recentValues(values, MIN_WINDOW_SIZE));
  const medianValues = recentValues(values, 5).sort((a, b) => a - b);
  return [
    {
      name: "LINEAR_REGRESSION",
      predicted: fullRegression?.predicted ?? 0,
      slope: fullRegression?.slope ?? 0,
      intercept: fullRegression?.intercept ?? 0,
    },
    {
      name: "RECENT_5_MONTH_LINEAR_REGRESSION",
      predicted: recentRegression?.predicted ?? 0,
      slope: recentRegression?.slope ?? 0,
      intercept: recentRegression?.intercept ?? 0,
    },
    {
      name: "RECENT_3_MONTH_AVERAGE",
      predicted: recentAverage(values),
      slope: null,
      intercept: null,
    },
    { name: 'RECENT_WEIGHTED_LINEAR_REGRESSION', ...weightedLinearRegression(values) },
    { name: 'RECENT_5_MONTH_MEDIAN', predicted: medianValues[Math.floor(medianValues.length / 2)], slope: null, intercept: null },
    { name: 'LAST_MONTH_CONSUMPTION', predicted: values.at(-1), slope: null, intercept: null },
  ];
}

export function selectLegacyForecastModel(values) {
  const legacyNames = ['LINEAR_REGRESSION', 'RECENT_5_MONTH_LINEAR_REGRESSION', 'RECENT_3_MONTH_AVERAGE'];
  const candidates = forecastCandidates(values).filter((candidate) => legacyNames.includes(candidate.name));
  if (candidates.length === 0) return null;

  // Compare each candidate with known, later months. This rolling back-test
  // avoids choosing a model merely because it fits old data nicely.
  const scores = new Map(candidates.map((candidate) => [candidate.name, { error: 0, count: 0 }]));
  for (let targetIndex = MIN_WINDOW_SIZE; targetIndex < values.length; targetIndex += 1) {
    const training = values.slice(0, targetIndex);
    const actual = values[targetIndex];
    for (const candidate of forecastCandidates(training).filter((candidate) => legacyNames.includes(candidate.name))) {
      const score = scores.get(candidate.name);
      score.error += Math.abs(candidate.predicted - actual);
      score.count += 1;
    }
  }

  // With fewer than six readings no holdout month exists, so retain the
  // established straight-line forecast rather than overfitting a tiny sample.
  const eligible = candidates.filter((candidate) => scores.get(candidate.name).count > 0);
  if (eligible.length === 0) return candidates[0];
  return eligible.sort((left, right) => {
    const leftScore = scores.get(left.name);
    const rightScore = scores.get(right.name);
    const difference = (leftScore.error / leftScore.count) - (rightScore.error / rightScore.count);
    return Math.abs(difference) < 0.000001 ? candidates.indexOf(left) - candidates.indexOf(right) : difference;
  })[0];
}

export function selectForecastModel(values) {
  const candidates = forecastCandidates(values);
  if (!candidates.length) return null;
  if (values.length - MIN_WINDOW_SIZE < 2) return candidates[0];
  const preference = ['LAST_MONTH_CONSUMPTION', 'RECENT_3_MONTH_AVERAGE', 'RECENT_5_MONTH_MEDIAN',
    'LINEAR_REGRESSION', 'RECENT_5_MONTH_LINEAR_REGRESSION', 'RECENT_WEIGHTED_LINEAR_REGRESSION'];
  const errors = new Map(candidates.map((candidate) => [candidate.name, 0]));
  for (let target = MIN_WINDOW_SIZE; target < values.length; target += 1) {
    for (const candidate of forecastCandidates(values.slice(0, target))) {
      errors.set(candidate.name, errors.get(candidate.name) + Math.abs(candidate.predicted - Number(values[target])));
    }
  }
  return [...candidates].sort((a, b) => {
    const difference = (errors.get(a.name) - errors.get(b.name)) / (values.length - MIN_WINDOW_SIZE);
    return Math.abs(difference) <= 0.000001 ? preference.indexOf(a.name) - preference.indexOf(b.name) : difference;
  })[0];
}

export function selectStableForecastModel(values) {
  const candidates = forecastCandidates(values);
  if (!candidates.length) return null;
  // Keep the established warm-up rule: two earlier comparison months are
  // needed before using a method other than full-window regression.
  if (values.length - MIN_WINDOW_SIZE < 2) return candidates[0];
  const normalized = values.map(numeric);
  const regression = candidates[0];
  // An exact observed linear trend supports extrapolation. Irregular histories
  // have too few holdouts to reliably pick one of six competing methods.
  const exactTrend = regression.slope !== 0 && normalized.every((value, index) =>
    Math.abs(value - (regression.intercept + regression.slope * index)) <= 0.000001);
  if (exactTrend) return regression;
  const stableNames = ['LAST_MONTH_CONSUMPTION', 'RECENT_3_MONTH_AVERAGE', 'RECENT_5_MONTH_MEDIAN'];
  const stable = candidates.filter((candidate) => stableNames.includes(candidate.name));
  return {
    name: 'STABLE_RECENT_ENSEMBLE',
    predicted: stable.reduce((sum, candidate) => sum + candidate.predicted, 0) / stable.length,
    slope: null,
    intercept: null,
  };
}

// Receives the consecutive, valid, source-bounded training window from buildForecast.
// Each event sees only its own five preceding months, never later observations.
export function selectRegressionFirstForecastModel(readings) {
  const candidates = forecastCandidates(readings.map((row) => row.consumption));
  if (!candidates.length) return null;
  for (let index = readings.length - 1; index >= Math.max(0, readings.length - 3); index -= 1) {
    if (index < usageReviewRule.historyMonths) continue;
    const change = classifyUsageChange(
      readings.slice(index - usageReviewRule.historyMonths, index).map((row) => row.consumption),
      readings[index].consumption,
    );
    if (!change || !['USAGE_SPIKE', 'ZERO_AFTER_REGULAR_USE'].includes(change.type)) continue;
    const month = new Date(readings[index].periodStart).toLocaleDateString('en-US', {
      month: 'short', year: 'numeric', timeZone: 'UTC',
    });
    const event = change.type === 'USAGE_SPIKE' ? 'unusually high consumption' : 'unexpected zero consumption';
    const stable = candidates.filter((candidate) =>
      ['LAST_MONTH_CONSUMPTION', 'RECENT_3_MONTH_AVERAGE', 'RECENT_5_MONTH_MEDIAN'].includes(candidate.name));
    return {
      name: 'STABLE_RECENT_ENSEMBLE',
      predicted: stable.reduce((sum, candidate) => sum + candidate.predicted, 0) / stable.length,
      slope: null,
      intercept: null,
      reason: `Stable Recent Months: ${event} in ${month}, within the latest three months.`,
    };
  }
  return { ...candidates[0], reason: 'Linear Regression: no qualifying spike or unexpected zero detected in the latest three months (five prior valid months required).' };
}

export function selectConsecutiveReadings(history, windowSize = MAX_WINDOW_SIZE) {
  if (!Array.isArray(history) || history.length === 0) return [];
  const sorted = [...history].sort((a, b) => monthIndex(a.periodStart) - monthIndex(b.periodStart));
  const segment = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const reading = sorted[index];
    const consumption = numeric(reading.consumption);
    if (reading.validationStatus !== "VALID" || consumption === null || consumption < 0) break;
    if (segment.length > 0) {
      const newer = segment[0];
      if (monthIndex(newer.periodStart) - monthIndex(reading.periodStart) !== 1) break;
    }
    segment.unshift(reading);
    if (segment.length === windowSize) break;
  }
  return segment;
}

export function buildForecast(history, { waterRate = 0, minWindow = MIN_WINDOW_SIZE, maxWindow = MAX_WINDOW_SIZE,
  sourceMonth, policy = ACTIVE_FORECAST_POLICY } = {}) {
  const sorted = [...(history || [])].filter((row) => !sourceMonth || monthIndex(row.periodStart) <= monthIndex(sourceMonth))
    .sort((a, b) => monthIndex(a.periodStart) - monthIndex(b.periodStart));
  const latest = sorted.at(-1);
  if (!latest) {
    return { status: "INSUFFICIENT_DATA", reason: "No meter readings are available.", sampleCount: 0 };
  }
  if (sourceMonth && monthIndex(latest.periodStart) !== monthIndex(sourceMonth)) {
    return { status: 'INSUFFICIENT_DATA', reason: 'A valid reading is required in the forecast source month.', sampleCount: 0 };
  }
  if (latest.validationStatus !== "VALID") {
    return { status: "FLAGGED_READING", reason: "The latest meter reading requires review.", sampleCount: 0 };
  }

  // Pulls up to 12 consecutive months if available
  const selected = selectConsecutiveReadings(sorted, maxWindow);

  // Fails only if fewer than 5 consecutive months exist
  if (selected.length < minWindow) {
    return {
      status: "INSUFFICIENT_DATA",
      reason: `At least ${minWindow} consecutive valid monthly readings are required.`,
      sampleCount: selected.length,
    };
  }

  const selectModel = policy === 'stable' ? selectStableForecastModel
    : policy === 'revised' ? selectForecastModel : selectLegacyForecastModel;
  const model = policy === 'regression_first' ? selectRegressionFirstForecastModel(selected)
    : selectModel(selected.map((reading) => reading.consumption));
  if (!model) return { status: 'INSUFFICIENT_DATA', reason: 'Valid numeric readings are required.', sampleCount: selected.length };
  const predictedConsumption = Number(model.predicted.toFixed(3));

  return {
    status: "READY",
    reason: model.reason ?? null,
    sampleCount: selected.length,
    predictedConsumption,
    estimatedWaterCharge: Number((predictedConsumption * numeric(waterRate || 0)).toFixed(2)),
    modelName: model.name,
    slope: model.slope,
    intercept: model.intercept,
  };
}

export function calculateAccuracy(rows, { round = true } = {}) {
  const evaluated = (rows || []).filter((row) => {
    const predicted = numeric(row.predictedConsumption);
    const actual = numeric(row.actualConsumption);
    return predicted !== null && predicted >= 0 && actual !== null && actual >= 0;
  });
  if (evaluated.length === 0) return { evaluatedCount: 0, mae: null, rmse: null, wape: null, accuracy: null };
  const errors = evaluated.map((row) => Math.abs(Number(row.predictedConsumption) - Number(row.actualConsumption)));
  const actualTotal = evaluated.reduce((sum, row) => sum + Number(row.actualConsumption), 0);
  const mae = errors.reduce((sum, error) => sum + error, 0) / errors.length;
  const rmse = Math.sqrt(errors.reduce((sum, error) => sum + (error ** 2), 0) / errors.length);
  const wape = actualTotal > 0 ? errors.reduce((sum, error) => sum + error, 0) / actualTotal : null;
  const rounded = (value, digits) => round ? Number(value.toFixed(digits)) : value;
  return {
    evaluatedCount: evaluated.length,
    mae: rounded(mae, 3),
    rmse: rounded(rmse, 3),
    wape: wape === null ? null : rounded(wape * 100, 2),
    accuracy: wape === null ? null : rounded(Math.max(0, 1 - wape) * 100, 2),
  };
}

export async function regenerateForecasts(client, billingPeriodId) {
  const periodResult = await client.query(
    `SELECT id, period_start AS "periodStart", water_rate_per_cubic_m AS "waterRate"
    FROM billing_periods p WHERE id = $1 AND ${analyticsPeriodCondition('p')}`,
    [billingPeriodId],
  );
  const period = periodResult.rows[0];
  if (!period) return;

  const readingsResult = await client.query(
    `SELECT m.unit_id AS "unitId", p.period_start AS "periodStart",
    m.current_reading - m.previous_reading AS consumption,
    m.validation_status AS "validationStatus"
    FROM meter_readings m
    JOIN billing_periods p ON p.id = m.billing_period_id
    WHERE p.period_start <= $1 AND ${analyticsPeriodCondition('p')}
    ORDER BY m.unit_id, p.period_start`,
    [period.periodStart],
  );
  const unitsResult = await client.query("SELECT id FROM units ORDER BY id");
  const historyByUnit = new Map();
  for (const reading of readingsResult.rows) {
    const key = Number(reading.unitId);
    if (!historyByUnit.has(key)) historyByUnit.set(key, []);
    historyByUnit.get(key).push(reading);
  }

  await client.query("DELETE FROM billing_forecasts WHERE based_on_period_id = $1", [billingPeriodId]);
  const forecastMonth = nextMonthStart(period.periodStart);
  for (const unit of unitsResult.rows) {
    const forecast = buildForecast(historyByUnit.get(Number(unit.id)) || [], { waterRate: period.waterRate, sourceMonth: period.periodStart });
    await client.query(
      `INSERT INTO billing_forecasts
        (unit_id, based_on_period_id, forecast_for_month, predicted_consumption,
        estimated_water_charge, model_name, sample_count, slope, intercept, forecast_status, status_reason)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [unit.id, billingPeriodId, forecastMonth, forecast.predictedConsumption ?? null,
        forecast.estimatedWaterCharge ?? null, forecast.modelName ?? "LINEAR_REGRESSION",
        forecast.sampleCount, forecast.slope ?? null, forecast.intercept ?? null,
        forecast.status, forecast.reason],
    );
  }
}

export async function regenerateForecastsFromPeriod(client, billingPeriodId) {
  const periods = await client.query(
    `SELECT id FROM billing_periods p
    WHERE period_start >= (SELECT period_start FROM billing_periods WHERE id = $1)
       AND ${analyticsPeriodCondition('p')}
    ORDER BY period_start`,
    [billingPeriodId],
  );
  for (const period of periods.rows) await regenerateForecasts(client, period.id);
}

export { MIN_WINDOW_SIZE, MAX_WINDOW_SIZE, WINDOW_SIZE };

// #endregion

// #region Actual usage change review

export function detectUsageChange(history, sourceMonth, actualConsumption) {
  const training = (history || []).filter((row) => monthIndex(row.periodStart) <= monthIndex(sourceMonth));
  const selected = selectConsecutiveReadings(training, usageReviewRule.historyMonths);
  if (selected.length < usageReviewRule.historyMonths
    || monthIndex(selected.at(-1).periodStart) !== monthIndex(sourceMonth)) return null;
  return classifyUsageChange(selected.map((row) => row.consumption), actualConsumption);
}

function totals(rows) {
  return {
    actualConsumption: Number(rows.reduce((sum, row) => sum + Number(row.actualConsumption), 0).toFixed(3)),
    absoluteError: Number(rows.reduce((sum, row) => sum + Math.abs(Number(row.predictedConsumption) - Number(row.actualConsumption)), 0).toFixed(3)),
  };
}

// The caller supplies exactly the valid pairs used for overall evaluation.
export function summarizeUsageReview(paired, byUnit) {
  const typical = [];
  const alerts = [];
  const alertPairs = [];
  const totalError = paired.reduce((sum, row) => sum + Math.abs(Number(row.predictedConsumption) - Number(row.actualConsumption)), 0);
  for (const row of paired) {
    const change = detectUsageChange(byUnit.get(String(row.unitId)) || [], row.basedOnPeriodStart, row.actualConsumption);
    if (!change) {
      typical.push(row);
      continue;
    }
    const absoluteError = Math.abs(Number(row.predictedConsumption) - Number(row.actualConsumption));
    alertPairs.push(row);
    alerts.push({ ...change, unitId: row.unitId, unitNumber: row.unitNumber,
      forecastForMonth: row.forecastForMonth, predictedConsumption: Number(row.predictedConsumption),
      absoluteError: Number(absoluteError.toFixed(3)),
      errorShare: totalError > 0 ? Number((absoluteError / totalError * 100).toFixed(2)) : 0,
    });
  }
  const alertError = alertPairs.reduce((sum, row) => sum + Math.abs(Number(row.predictedConsumption) - Number(row.actualConsumption)), 0);
  return {
    rule: usageReviewRule,
    alertCount: alerts.length,
    alerts: alerts.sort((a, b) => b.absoluteError - a.absoluteError || String(a.unitId).localeCompare(String(b.unitId))),
    alertErrorShare: totalError > 0 ? Number((alertError / totalError * 100).toFixed(2)) : 0,
    alertTotals: totals(alertPairs),
    typicalMetrics: calculateAccuracy(typical),
    typicalTotals: totals(typical),
    typicalBaselines: {
      lastMonth: calculateAccuracy(typical.map((row) => ({ ...row, predictedConsumption: row.baselines.lastMonth }))),
      recentAverage: calculateAccuracy(typical.map((row) => ({ ...row, predictedConsumption: row.baselines.recentAverage }))),
    },
  };
}

// #endregion

// #region Prescriptive recommendations

const ACTIVE_STATUSES = ['OPEN', 'VIEWED'];
export const HIGH_USAGE_THRESHOLD = 0.15;
export const VACANT_USAGE_THRESHOLD = 1;
export const EARLY_MONITORING_PERCENT = 0.9;

export const RECOMMENDATION_TYPES = {
  REVIEW_METER_READING: 'REVIEW_METER_READING',
  COLLECT_MORE_HISTORY: 'COLLECT_MORE_HISTORY',
  CHECK_HIGH_USAGE: 'CHECK_HIGH_USAGE',
  VACANT_UNIT_USAGE: 'VACANT_UNIT_USAGE',
  RISING_CONSUMPTION: 'RISING_CONSUMPTION',
  PAYMENT_REMINDER: 'PAYMENT_REMINDER',
  MONITOR_HIGH_USAGE: 'MONITOR_HIGH_USAGE',
  MONITOR_USAGE: 'MONITOR_USAGE',
};

export function isResidentVisibleRecommendation(type) {
  return [
    RECOMMENDATION_TYPES.CHECK_HIGH_USAGE,
    RECOMMENDATION_TYPES.RISING_CONSUMPTION,
    RECOMMENDATION_TYPES.PAYMENT_REMINDER,
    RECOMMENDATION_TYPES.MONITOR_HIGH_USAGE,
    RECOMMENDATION_TYPES.MONITOR_USAGE,
  ].includes(type);
}

function number(value) {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rounded(value, decimals = 3) {
  return Number(Number(value).toFixed(decimals));
}

function latestReading(history) {
  return [...(history || [])].sort((left, right) => String(left.periodStart).localeCompare(String(right.periodStart))).at(-1);
}

function action(recommendationType, priority, condition, message, evidence = {}) {
  return { recommendationType, priority, message, evidence: { condition, ...evidence } };
}

function daysUntil(date, today = new Date()) {
  if (!date) return null;
  const due = new Date(`${String(date).slice(0, 10)}T00:00:00Z`);
  const current = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  return Math.round((due - current) / 86400000);
}

export function buildPrescriptiveRecommendations({ forecast, history = [], context = {} }) {
  if (!forecast) return [];
  const latest = latestReading(history);
  if (forecast.status === 'FLAGGED_READING' || latest?.validationStatus === 'FLAGGED') {
    return [action(
      RECOMMENDATION_TYPES.REVIEW_METER_READING,
      'HIGH',
      'The latest meter reading is unusually high, lower than the previous reading, or breaks the expected sequence.',
      'Ask the Billing Associate to recheck the meter reading and upload a meter photo before it is used for billing or forecasting.',
      { reason: forecast.reason || latest?.validationNotes || 'The latest meter reading needs review.', latestPeriod: latest?.periodStart || null },
    )];
  }

  const recommendations = [];
  const validThree = selectConsecutiveReadings(history, 3);
  const latestConsumption = number(latest?.consumption);
  const positiveBaseline = validThree
    .map((reading) => number(reading.consumption))
    .filter((consumption) => consumption !== null && consumption > 0);
  const positiveBaselineCount = positiveBaseline.length;
  const zeroReadingCount = validThree.filter((reading) => number(reading.consumption) === 0).length;
  const positiveBaselineAverage = positiveBaselineCount
    ? positiveBaseline.reduce((sum, consumption) => sum + consumption, 0) / positiveBaselineCount
    : null;

  if (forecast.status === 'INSUFFICIENT_DATA') {
    const validWindow = selectConsecutiveReadings(history, MIN_WINDOW_SIZE);
    const sampleCount = Math.min(Number(forecast.sampleCount ?? validWindow.length) || 0, MIN_WINDOW_SIZE);
    const missingMonths = Math.max(MIN_WINDOW_SIZE - sampleCount, 1);
    recommendations.push(action(
      RECOMMENDATION_TYPES.COLLECT_MORE_HISTORY,
      'LOW',
      `Only ${sampleCount} of the required ${MIN_WINDOW_SIZE} consecutive valid monthly readings are available.`,
      `Record ${missingMonths} more consecutive valid monthly meter reading${missingMonths === 1 ? '' : 's'} before relying on a forecast.`,
      { sampleCount, missingMonths, requiredMonths: MIN_WINDOW_SIZE },
    ));
  }

  if (validThree.length === 3 && validThree.every((reading, index) => index === 0
    || number(reading.consumption) > number(validThree[index - 1].consumption))) {
    recommendations.push(action(
      RECOMMENDATION_TYPES.RISING_CONSUMPTION,
      'LOW',
      'Three consecutive valid monthly readings show rising water consumption.',
      'Notify the resident and recommend water-saving actions while monitoring the next meter reading.',
      { periods: validThree.map((reading) => reading.periodStart), values: validThree.map((reading) => rounded(reading.consumption)) },
    ));
  }

  if (context.occupancyStatus === 'VACANT' && latestConsumption !== null && latestConsumption > VACANT_USAGE_THRESHOLD) {
    recommendations.push(action(
      RECOMMENDATION_TYPES.VACANT_UNIT_USAGE,
      'HIGH',
      `Unit is marked vacant but recorded ${rounded(latestConsumption)} m3 of water use (threshold: ${VACANT_USAGE_THRESHOLD} m3).`,
      'Request a physical inspection for leaks, unauthorized use, or an incorrect occupancy status.',
      { latestConsumption: rounded(latestConsumption), threshold: VACANT_USAGE_THRESHOLD },
    ));
  }

  if (forecast.status === 'READY' && validThree.length === 3) {
    const predicted = number(forecast.predictedConsumption);
    if (predicted !== null && positiveBaselineCount >= 2 && positiveBaselineAverage > 0) {
      const increasePercent = rounded(((predicted - positiveBaselineAverage) / positiveBaselineAverage) * 100, 2);
      if (predicted >= positiveBaselineAverage * (1 + HIGH_USAGE_THRESHOLD)) {
        recommendations.push(action(
          RECOMMENDATION_TYPES.CHECK_HIGH_USAGE,
          'HIGH',
          `Forecast is ${Math.round(increasePercent)}% above the unit's recent positive-consumption average.`,
          'Check toilet flushes, faucets, showerheads, and visible leaks; confirm that the meter has no unusual use.',
          {
            predictedConsumption: rounded(predicted),
            recentAverage: rounded(positiveBaselineAverage),
            positiveBaselineCount,
            zeroReadingCount,
            baselineMethod: 'POSITIVE_READINGS_ONLY',
            increasePercent,
            thresholdPercent: HIGH_USAGE_THRESHOLD * 100,
          },
        ));
      } else {
        const recentHigh = Math.max(...validThree.map((reading) => number(reading.consumption) || 0));
        if (recentHigh > 0 && predicted >= recentHigh * EARLY_MONITORING_PERCENT) {
          recommendations.push(action(
            RECOMMENDATION_TYPES.MONITOR_HIGH_USAGE,
            'LOW',
            `Forecast is near the unit's usual high-consumption level of ${rounded(recentHigh)} m3.`,
            'Encourage early monitoring and water-saving actions before the next meter reading.',
            {
              predictedConsumption: rounded(predicted),
              recentHigh: rounded(recentHigh),
              recentAverage: rounded(positiveBaselineAverage),
              positiveBaselineCount,
              zeroReadingCount,
              baselineMethod: 'POSITIVE_READINGS_ONLY',
              monitoringPercent: EARLY_MONITORING_PERCENT * 100,
            },
          ));
        }
      }
    }
  }

  const remainingBalance = number(context.remainingBalance);
  const days = daysUntil(context.dueDate, context.today);
  if (remainingBalance !== null && remainingBalance > 0 && days !== null && days >= 0 && days <= 5) {
    recommendations.push(action(
      RECOMMENDATION_TYPES.PAYMENT_REMINDER,
      'LOW',
      `An unpaid balance of PHP ${rounded(remainingBalance, 2).toFixed(2)} is due in ${days} day${days === 1 ? '' : 's'}.`,
      'Send an in-app payment reminder to the assigned payer with the due date and remaining balance.',
      { remainingBalance: rounded(remainingBalance, 2), dueDate: context.dueDate, daysUntilDue: days, chargePayments: context.chargePayments },
    ));
  }

  if (recommendations.length === 0) {
    const recentValues = validThree.map((reading) => rounded(reading.consumption));
    const recentAverage = positiveBaselineAverage === null ? null : rounded(positiveBaselineAverage);
    const previousConsumption = validThree.length > 1 ? number(validThree.at(-2).consumption) : null;
    const monthChangePercent = previousConsumption && latestConsumption !== null
      ? rounded(((latestConsumption - previousConsumption) / previousConsumption) * 100, 2)
      : null;
    const hasForecast = forecast.status === 'READY' && number(forecast.predictedConsumption) !== null;
    const condition = forecast.status === 'INSUFFICIENT_DATA'
      ? 'More valid monthly readings are needed before a reliable forecast can be made.'
      : positiveBaselineCount < 2
        ? 'Recent readings include zero-consumption months, so a reliable percentage comparison is not available yet.'
      : 'No high-usage, rising-consumption, or payment warning threshold is currently active.';
    const message = forecast.status === 'INSUFFICIENT_DATA'
      ? 'Continue recording monthly meter readings so the system can produce a reliable forecast.'
      : positiveBaselineCount < 2
        ? 'Continue recording monthly readings until at least two positive consumption readings are available.'
      : 'Water use is currently within the monitoring thresholds. Continue checking the next monthly meter reading.';
    recommendations.push(action(
      RECOMMENDATION_TYPES.MONITOR_USAGE,
      'LOW',
      condition,
      message,
      {
        latestConsumption: latestConsumption === null ? null : rounded(latestConsumption),
        recentAverage,
        predictedConsumption: hasForecast ? rounded(forecast.predictedConsumption) : null,
        monthChangePercent,
        recentValues,
        positiveBaselineCount,
        zeroReadingCount,
        baselineMethod: 'POSITIVE_READINGS_ONLY',
        forecastStatus: forecast.status,
      },
    ));
  }
  return recommendations;
}

export async function ensurePrescriptiveAnalyticsSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS prescriptive_recommendations (
      id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      unit_id BIGINT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
      based_on_period_id BIGINT NOT NULL REFERENCES billing_periods(id) ON DELETE CASCADE,
      forecast_id BIGINT NULL REFERENCES billing_forecasts(id) ON DELETE SET NULL,
      recommendation_type VARCHAR(50) NOT NULL,
      priority VARCHAR(20) NOT NULL CHECK (priority IN ('HIGH', 'LOW')),
      status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'VIEWED', 'SUPERSEDED')),
      message VARCHAR(500) NOT NULL,
      evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
      resident_visible_at TIMESTAMPTZ NULL,
      resident_visible_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (unit_id, based_on_period_id, recommendation_type)
    )
  `);
  await client.query('CREATE INDEX IF NOT EXISTS prescriptive_recommendations_active_idx ON prescriptive_recommendations(status, priority, updated_at DESC)');
  await client.query('CREATE INDEX IF NOT EXISTS prescriptive_recommendations_resident_idx ON prescriptive_recommendations(unit_id, resident_visible_at DESC) WHERE resident_visible_at IS NOT NULL');
}

async function supersedeInactiveRecommendations(client, latestPeriodId, desiredKeys, supersedeOlderPeriods) {
  const existing = await client.query(
    `SELECT id, unit_id AS "unitId", based_on_period_id AS "basedOnPeriodId", recommendation_type AS "recommendationType"
     FROM prescriptive_recommendations WHERE status = ANY($1::varchar[])`,
    [ACTIVE_STATUSES],
  );
  for (const item of existing.rows) {
    if (!supersedeOlderPeriods && Number(item.basedOnPeriodId) !== Number(latestPeriodId)) continue;
    const key = `${item.unitId}:${item.basedOnPeriodId}:${item.recommendationType}`;
    if (Number(item.basedOnPeriodId) === Number(latestPeriodId) && desiredKeys.has(key)) continue;
    await client.query("UPDATE prescriptive_recommendations SET status = 'SUPERSEDED', updated_at = NOW() WHERE id = $1", [item.id]);
  }
}

export async function regeneratePrescriptiveRecommendations(client, options = {}) {
  await ensurePrescriptiveAnalyticsSchema(client);
  const generatedPeriodId = options.generatedPeriodId ? Number(options.generatedPeriodId) : null;
  const periodResult = await client.query(
    `SELECT p.id, p.period_start AS "periodStart", p.status
     FROM billing_periods p WHERE p.period_type = 'LIVE_BILLING' AND ${analyticsPeriodCondition('p')}
       AND EXISTS (SELECT 1 FROM billing_forecasts f WHERE f.based_on_period_id = p.id)
       AND ($1::bigint IS NULL OR p.id = $1)
     ORDER BY p.period_start DESC LIMIT 1`,
    [generatedPeriodId],
  );
  const period = periodResult.rows[0];
  if (!period) return [];
  const [forecastsResult, historyResult, billsResult] = await Promise.all([
    client.query(
      `SELECT f.id AS "forecastId", f.unit_id AS "unitId", f.forecast_status AS status,
        f.status_reason AS reason, f.sample_count AS "sampleCount", f.predicted_consumption AS "predictedConsumption",
        u.occupancy_status AS "occupancyStatus"
       FROM billing_forecasts f JOIN units u ON u.id = f.unit_id WHERE f.based_on_period_id = $1`,
      [period.id],
    ),
    client.query(
      `SELECT m.unit_id AS "unitId", p.period_start AS "periodStart", m.current_reading - m.previous_reading AS consumption,
        m.validation_status AS "validationStatus", m.validation_notes AS "validationNotes"
       FROM meter_readings m JOIN billing_periods p ON p.id = m.billing_period_id
       WHERE p.period_start <= $1 AND ${analyticsPeriodCondition('p')} ORDER BY m.unit_id, p.period_start`, [period.periodStart],
    ),
    client.query(
      `SELECT b.unit_id AS "unitId", b.due_date_snapshot AS "dueDate",
        ${chargePaymentsSql} AS "chargePayments",
        GREATEST(${billTotalSql} - ${billAppliedSql}, 0) AS "remainingBalance"
       FROM unit_bills b
       WHERE b.billing_period_id = $1`, [period.id],
    ),
  ]);
  const historyByUnit = new Map();
  for (const reading of historyResult.rows) {
    const unitId = Number(reading.unitId);
    if (!historyByUnit.has(unitId)) historyByUnit.set(unitId, []);
    historyByUnit.get(unitId).push(reading);
  }
  const billByUnit = new Map(billsResult.rows.map((bill) => [Number(bill.unitId), bill]));
  const desired = forecastsResult.rows.flatMap((forecast) => {
    const bill = billByUnit.get(Number(forecast.unitId));
    return buildPrescriptiveRecommendations({
      forecast, history: historyByUnit.get(Number(forecast.unitId)) || [],
      context: { occupancyStatus: forecast.occupancyStatus, dueDate: bill?.dueDate, remainingBalance: bill?.remainingBalance, chargePayments: bill?.chargePayments },
    }).map((item) => ({ ...item, unitId: Number(forecast.unitId), forecastId: forecast.forecastId }));
  });
  const desiredKeys = new Set(desired.map((item) => `${item.unitId}:${period.id}:${item.recommendationType}`));
  await supersedeInactiveRecommendations(client, period.id, desiredKeys, Boolean(generatedPeriodId));
  const residentVisible = ['GENERATED', 'FORWARDED', 'CLOSED'].includes(period.status);
  for (const item of desired) {
    const visible = residentVisible && isResidentVisibleRecommendation(item.recommendationType);
    await client.query(
      `INSERT INTO prescriptive_recommendations
        (unit_id, based_on_period_id, forecast_id, recommendation_type, priority, message, evidence, resident_visible_at, resident_visible_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, CASE WHEN $8 THEN NOW() ELSE NULL END, $9)
       ON CONFLICT (unit_id, based_on_period_id, recommendation_type) DO UPDATE
       SET forecast_id = EXCLUDED.forecast_id, priority = EXCLUDED.priority, message = EXCLUDED.message, evidence = EXCLUDED.evidence,
           status = CASE WHEN prescriptive_recommendations.status = 'SUPERSEDED' THEN 'OPEN' ELSE prescriptive_recommendations.status END,
           resident_visible_at = CASE WHEN $8 THEN COALESCE(prescriptive_recommendations.resident_visible_at, NOW()) ELSE prescriptive_recommendations.resident_visible_at END,
           resident_visible_by = CASE WHEN $8 THEN COALESCE(prescriptive_recommendations.resident_visible_by, $9) ELSE prescriptive_recommendations.resident_visible_by END,
           updated_at = NOW()`,
      [item.unitId, period.id, item.forecastId, item.recommendationType, item.priority, item.message, JSON.stringify(item.evidence), visible, visible ? options.residentVisibleBy : null],
    );
  }
  return desired;
}

// #endregion

// #region Forecast evaluation and baselines

function forecastEvaluationValidNumber(value) {
  return value !== null && value !== undefined && typeof value !== 'boolean' &&
  !(typeof value === 'string' && value.trim() === '') && Number.isFinite(Number(value)) && Number(value) >= 0;
}

function monthStart(value) {
  return `${String(value).slice(0, 7)}-01`;
}

export function validEvaluationPair(row) {
  return row.status === 'READY' && row.actualValidationStatus === 'VALID' &&
  forecastEvaluationValidNumber(row.predictedConsumption) && forecastEvaluationValidNumber(row.actualConsumption);
}

function groupHistory(readings) {
  const byUnit = new Map();
  for (const reading of readings) {
    const key = String(reading.unitId);
    if (!byUnit.has(key)) byUnit.set(key, []);
    byUnit.get(key).push(reading);
  }
  return byUnit;
}

export function evaluationBaselines(history, sourceMonth) {
  const training = history.filter((reading) => reading.periodStart <= sourceMonth);
  const forecast = buildForecast(training, { sourceMonth, policy: 'legacy' });
  if (forecast.status !== 'READY') return null;
  const candidates = forecastCandidates(selectConsecutiveReadings(training).map((reading) => reading.consumption));
  return {
    lastMonth: candidates.find((candidate) => candidate.name === 'LAST_MONTH_CONSUMPTION').predicted,
    recentAverage: candidates.find((candidate) => candidate.name === 'RECENT_3_MONTH_AVERAGE').predicted
  };
}

// Saved predictions and baselines are compared on the same valid unit/month pairs.
export function summarizeEvaluationHistory(diagnostics, readings) {
  const byUnit = groupHistory(readings);
  const months = new Map();
  for (const row of diagnostics) {
    const key = String(row.forecastForMonth).slice(0, 10);
    if (!months.has(key)) months.set(key, []);
    months.get(key).push(row);
  }
  return [...months].sort(([a], [b]) => a.localeCompare(b)).map(([forecastForMonth, rows]) => {
    const paired = rows.filter(validEvaluationPair).flatMap((row) => {
      if (nextMonthStart(row.basedOnPeriodStart) !== forecastForMonth) return [];
      const baselines = evaluationBaselines(byUnit.get(String(row.unitId)) || [], row.basedOnPeriodStart);
      return baselines ? [{ ...row, baselines }] : [];
    });
    const metrics = { ...calculateAccuracy(paired), excludedCount: rows.length - paired.length };
    const actualTotal = paired.reduce((sum, row) => sum + Number(row.actualConsumption), 0);
    const absoluteErrorTotal = paired.reduce((sum, row) => sum + Math.abs(Number(row.predictedConsumption) - Number(row.actualConsumption)), 0);
    const topErrorUnits = paired.map((row) => ({
      unitId: row.unitId, unitNumber: row.unitNumber,
      predictedConsumption: Number(row.predictedConsumption), actualConsumption: Number(row.actualConsumption),
      absoluteError: Number(Math.abs(Number(row.predictedConsumption) - Number(row.actualConsumption)).toFixed(3)),
      errorShare: absoluteErrorTotal > 0 ?
      Number((Math.abs(Number(row.predictedConsumption) - Number(row.actualConsumption)) / absoluteErrorTotal * 100).toFixed(2)) : 0
    })).sort((a, b) => b.absoluteError - a.absoluteError || String(a.unitId).localeCompare(String(b.unitId))).slice(0, 5);
    return { forecastForMonth, evaluationType: 'RETROSPECTIVE', metrics,
      totals: { actualConsumption: Number(actualTotal.toFixed(3)), absoluteError: Number(absoluteErrorTotal.toFixed(3)) },
      topErrorUnits,
      usageReview: summarizeUsageReview(paired, byUnit),
      baselines: {
        lastMonth: calculateAccuracy(paired.map((row) => ({ ...row, predictedConsumption: row.baselines.lastMonth }))),
        recentAverage: calculateAccuracy(paired.map((row) => ({ ...row, predictedConsumption: row.baselines.recentAverage })))
      } };
  });
}

export function benchmarkDataset(dataset) {
  const byUnit = groupHistory(dataset.readings);
  const actuals = new Map(dataset.readings.map((row) => [`${row.unitId}:${monthStart(row.periodStart)}`, row]));
  const periodMonths = new Set(dataset.periods.map((period) => monthStart(period.periodStart)));
  const captured = new Map((dataset.baseline || []).map((row) => [`${row.unitId}:${row.basedOnPeriodId}`, row]));
  const pairs = [];
  const coverage = [];
  for (const period of dataset.periods) {
    const targetMonth = nextMonthStart(period.periodStart);
    if (!periodMonths.has(targetMonth)) continue;
    let evaluatedCount = 0;
    for (const unit of dataset.units) {
      const history = (byUnit.get(String(unit.unitId)) || []).filter((row) => row.periodStart <= period.periodStart);
      const actual = actuals.get(`${unit.unitId}:${targetMonth}`);
      const current = captured.get(`${unit.unitId}:${period.id}`) || buildForecast(history, { sourceMonth: period.periodStart, policy: 'legacy' });
      const revised = buildForecast(history, { sourceMonth: period.periodStart, policy: 'revised' });
      const baselines = evaluationBaselines(history, period.periodStart);
      if (!actual || actual.validationStatus !== 'VALID' || !forecastEvaluationValidNumber(actual.consumption) ||
      current.status !== 'READY' || !forecastEvaluationValidNumber(current.predictedConsumption) ||
      revised.status !== 'READY' || !baselines) continue;
      evaluatedCount += 1;
      pairs.push({ unitId: unit.unitId, unitNumber: unit.unitNumber, forecastForMonth: targetMonth,
        actualConsumption: Number(actual.consumption), sourceMonth: period.periodStart,
        predictions: { current: current.predictedConsumption, revised: revised.predictedConsumption,
          lastMonth: baselines.lastMonth, recentAverage: baselines.recentAverage },
        models: { current: current.modelName, revised: revised.modelName }
      });
    }
    coverage.push({ forecastForMonth: targetMonth, evaluatedCount, excludedCount: dataset.units.length - evaluatedCount });
  }
  const methods = ['current', 'revised', 'lastMonth', 'recentAverage'];
  const score = (rows, method, round = true) => calculateAccuracy(rows.map((row) => ({
    actualConsumption: row.actualConsumption, predictedConsumption: row.predictions[method]
  })), { round });
  const metrics = (rows) => Object.fromEntries(methods.map((method) => [method, score(rows, method)]));
  const current = score(pairs, 'current', false);
  const revised = score(pairs, 'revised', false);
  const passed = pairs.length > 0 && current.wape !== null && revised.wape !== null &&
  revised.mae < current.mae && revised.wape < current.wape && revised.rmse <= current.rmse;
  const monthly = coverage.map((row) => ({ ...row, metrics: metrics(pairs.filter((pair) => pair.forecastForMonth === row.forecastForMonth)) }));
  const latest = monthly.filter((row) => row.evaluatedCount > 0).at(-1) || null;
  const errorsByUnit = new Map();
  for (const pair of pairs) {
    const row = errorsByUnit.get(String(pair.unitId)) || { unitId: pair.unitId, unitNumber: pair.unitNumber, currentError: 0, revisedError: 0 };
    row.currentError += Math.abs(pair.predictions.current - pair.actualConsumption);
    row.revisedError += Math.abs(pair.predictions.revised - pair.actualConsumption);
    errorsByUnit.set(String(pair.unitId), row);
  }
  return { capturedAt: dataset.capturedAt, evaluationType: 'RETROSPECTIVE',
    months: dataset.periods.map((period) => period.periodStart), aggregate: metrics(pairs), monthly, latest,
    acceptance: { passed, rule: 'Lower aggregate MAE and WAPE, with no increase in RMSE on identical pairs.' },
    topErrorUnits: [...errorsByUnit.values()].sort((a, b) => b.currentError - a.currentError).slice(0, 10), pairs
  };
}

// #endregion

// #region Forecast policy comparisons

const policies = ['stable', 'regression_first'];
const validActual = (row) => row?.validationStatus === 'VALID'
  && row.consumption !== null && row.consumption !== undefined && typeof row.consumption !== 'boolean'
  && !(typeof row.consumption === 'string' && row.consumption.trim() === '')
  && Number.isFinite(Number(row.consumption)) && Number(row.consumption) >= 0;
const countModels = (forecasts) => forecasts.reduce((counts, forecast) => {
  const key = forecast.status === 'READY' ? forecast.modelName : 'NO_FORECAST';
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}, {});

// Rebuild both policies on identical source-bounded history. No error-based exclusions.
export function compareForecastPolicies(dataset) {
  const periods = [...dataset.periods].sort((a, b) => monthIndex(a.periodStart) - monthIndex(b.periodStart));
  const byUnit = new Map(dataset.units.map((unit) => [String(unit.unitId), []]));
  const actuals = new Map();
  for (const row of dataset.readings) {
    byUnit.get(String(row.unitId))?.push(row);
    actuals.set(`${row.unitId}:${monthIndex(row.periodStart)}`, row);
  }
  const pairs = [];
  const monthly = [];
  const latest = {};
  let eligibilityMismatchCount = 0;
  for (const period of periods) {
    const monthPairs = [];
    const forecasts = Object.fromEntries(policies.map((policy) => [policy, []]));
    const exclusions = { missingActual: 0, invalidOrFlaggedActual: 0, unavailableForecast: 0 };
    for (const unit of dataset.units) {
      const history = byUnit.get(String(unit.unitId)) || [];
      const results = Object.fromEntries(policies.map((policy) => [policy, buildForecast(history, {
        sourceMonth: period.periodStart, waterRate: period.waterRate, policy,
      })]));
      for (const policy of policies) forecasts[policy].push(results[policy]);
      if (results.stable.status !== results.regression_first.status) eligibilityMismatchCount += 1;
      const actual = actuals.get(`${unit.unitId}:${monthIndex(period.periodStart) + 1}`);
      if (!actual) { exclusions.missingActual += 1; continue; }
      if (!validActual(actual)) { exclusions.invalidOrFlaggedActual += 1; continue; }
      if (policies.some((policy) => results[policy].status !== 'READY')) {
        exclusions.unavailableForecast += 1; continue;
      }
      monthPairs.push({ unitId: unit.unitId, unitNumber: unit.unitNumber,
        sourceMonth: period.periodStart, forecastForMonth: nextMonthStart(period.periodStart),
        actualConsumption: Number(actual.consumption),
        predictions: Object.fromEntries(policies.map((policy) => [policy, results[policy].predictedConsumption])),
        models: Object.fromEntries(policies.map((policy) => [policy, results[policy].modelName])),
      });
    }
    pairs.push(...monthPairs);
    const metrics = Object.fromEntries(policies.map((policy) => [policy, calculateAccuracy(monthPairs.map((row) => ({
      actualConsumption: row.actualConsumption, predictedConsumption: row.predictions[policy],
    })))]));
    monthly.push({ sourceMonth: period.periodStart, forecastForMonth: nextMonthStart(period.periodStart),
      evaluatedCount: monthPairs.length, exclusions, metrics });
    latest.sourceMonth = period.periodStart;
    latest.forecastForMonth = nextMonthStart(period.periodStart);
    latest.modelCounts = Object.fromEntries(policies.map((policy) => [policy, countModels(forecasts[policy])]));
  }
  return { capturedAt: dataset.capturedAt, evaluationType: 'RETROSPECTIVE',
    rule: 'Identical valid unit/month pairs, including actual zeros and spikes; no error-based exclusions.',
    evaluatedCount: pairs.length, eligibilityMismatchCount,
    aggregate: Object.fromEntries(policies.map((policy) => [policy, {
      ...calculateAccuracy(pairs.map((row) => ({ actualConsumption: row.actualConsumption, predictedConsumption: row.predictions[policy] }))),
      modelCounts: countModels(pairs.map((row) => ({ status: 'READY', modelName: row.models[policy] }))),
    }])), latest: periods.length ? latest : null, monthly, pairs };
}

// #endregion

// #region Admin water guidance

function adminWaterGuidanceNumber(value) {
  if (value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

const date = (value) => String(value || '').slice(0, 10);
const adminWaterGuidanceRounded = (value, decimals = 3) => Number(value.toFixed(decimals));
const unitLabel = (count) => `${count} ${count === 1 ? 'unit' : 'units'}`;
const money = (value) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const volume = (value) => new Intl.NumberFormat('en-PH', { maximumFractionDigits: 3 }).format(value);

// The charts share a comparable cohort, but prescribe different decisions:
// meter/usage work for consumption, and charge/rate validation for billing.
function withChartInsights(guidance) {
  const { sourcePeriod, comparison, coverage, recommendations } = guidance;
  const consumption = [],bill = [];
  if (!sourcePeriod) {
    consumption.push({ key: 'USAGE_HISTORY', priority: 'LOW', title: 'Establish the water-use history', condition: 'No eligible actual consumption month is available.', action: 'Record and validate consecutive monthly meter readings to establish a water-use forecast.' });
    bill.push({ key: 'BILLING_INPUTS', priority: 'LOW', title: 'Prepare the water-charge forecast', condition: 'No source billing period is available for a charge estimate.', action: 'Confirm the approved water rate and establish valid reading history before preparing projected resident water charges.' });
    return { ...guidance, chartInsights: { consumption, bill } };
  }
  const usageTrend = recommendations.find((item) => item.key === 'TREND');
  if (usageTrend) {
    const hasVolumes = comparison.actualConsumption !== null && comparison.projectedConsumption !== null;
    const difference = hasVolumes ? adminWaterGuidanceRounded(comparison.projectedConsumption - comparison.actualConsumption) : null;
    const condition = hasVolumes ?
    `Projected water use ${difference === 0 ? 'is unchanged' : `${difference > 0 ? 'increases' : 'decreases'} by ${volume(Math.abs(difference))} m³`} for the same ${unitLabel(coverage.comparableUnits)}.${comparison.changePercent === null ? ' A percentage comparison is unavailable because the actual baseline is zero.' : ` Change from the latest actual month: ${comparison.changePercent > 0 ? '+' : ''}${comparison.changePercent.toFixed(2)}%.`}` :
    'No units have both a ready water-use forecast and valid actual consumption in the source period.';
    consumption.push({ ...usageTrend, key: 'USAGE_TREND', condition });
  }
  const inspections = recommendations.find((item) => item.key === 'INSPECTIONS');
  if (inspections) consumption.push({ ...inspections, key: 'USAGE_INSPECTIONS' });

  const validRate = sourcePeriod.waterRate !== null && sourcePeriod.waterRate > 0;
  const hasCharges = comparison.actualWaterCharge !== null && comparison.projectedWaterCharge !== null;
  if (!validRate) {
    bill.push({ key: 'BILLING_RATE', priority: 'HIGH', title: 'Set a valid water rate before estimating charges', condition: 'Water-charge estimates are unavailable because the source period has no valid positive water rate.', action: 'Have the Billing Associate verify the water rate in the source billing period, then refresh the forecasts before preparing water charges.' });
  } else {
    if (hasCharges) {
      const difference = adminWaterGuidanceRounded(comparison.projectedWaterCharge - comparison.actualWaterCharge, 2);
      bill.push({ key: 'BILLING_CHANGE', priority: comparison.direction === 'INCREASE' ? 'HIGH' : 'LOW',
        title: difference === 0 ? 'Reconcile the next water-charge total' : `Review the projected ${money(Math.abs(difference))} ${difference > 0 ? 'increase' : 'decrease'} in charges`,
        condition: `Comparable resident water charges ${difference === 0 ? 'remain at ' + money(comparison.projectedWaterCharge) : `move from ${money(comparison.actualWaterCharge)} to ${money(comparison.projectedWaterCharge)}`} for ${unitLabel(coverage.comparableUnits)}.`,
        action: `Use ${money(comparison.projectedWaterCharge)} as a provisional water-charge estimate for these units. Reconcile the next SOA water charges with verified readings and the approved rate before issuing statements.` });
    } else {
      bill.push({ key: 'BILLING_DATA', priority: 'LOW', title: 'Complete the inputs for the billing estimate', condition: 'No comparable units have usable actual and projected water charges.', action: 'Resolve missing or invalid billing readings and refresh forecasts before preparing a provisional resident water-charge total.' });
    }
    bill.push({ key: 'BILLING_RATE', priority: 'LOW', title: 'Confirm the rate for the next billing period', condition: `The charge comparison uses the source rate of ${money(sourcePeriod.waterRate)}/m³ for both months.`, action: 'Check the approved water rate for the next billing period before generating SOAs. Recalculate water charges if that rate differs from the source rate.' });
    const uncovered = coverage.totalUnits - coverage.comparableUnits;
    if (hasCharges && uncovered > 0) {
      bill.push({ key: 'BILLING_COVERAGE', priority: 'LOW', title: `Complete the charge estimate for ${unitLabel(uncovered)}`, condition: `The comparable charge estimate covers ${coverage.comparableUnits} of ${coverage.totalUnits} units. Charges for the other ${unitLabel(uncovered)} are not included.`, action: 'Obtain the missing validated billing inputs before using a building-wide water-charge total. Keep this partial estimate separate from the final billed amount.' });
    }
  }
  return { ...guidance, chartInsights: { consumption, bill } };
}

// Pure calculation: no persisted recommendations, notifications, or forecast refreshes.
export function buildAdminWaterGuidance({ source = null, units = [], forecasts = [], history = [] } = {}) {
  const unitMap = new Map(units.map((unit) => [String(unit.id), unit]));
  const sourceMonth = source ? `${date(source.periodStart).slice(0, 7)}-01` : null;
  const forecastMonth = source ? nextMonthStart(source.periodStart) : null;
  const rate = adminWaterGuidanceNumber(source?.waterRate);
  const coverage = { totalUnits: unitMap.size, readyUnits: 0, comparableUnits: 0, missingForecastUnits: 0, insufficientHistoryUnits: 0, flaggedUnits: 0, invalidForecastUnits: 0, missingActualUnits: 0 };
  const inspections = { unitCount: 0, highUsageUnits: 0, vacantUsageUnits: 0, flaggedReadingUnits: 0 };
  const comparison = { actualConsumption: null, projectedConsumption: null, actualWaterCharge: null, projectedWaterCharge: null, changePercent: null, direction: 'UNAVAILABLE' };
  const recommendations = [];
  if (!source) {
    coverage.missingForecastUnits = coverage.totalUnits;
    return withChartInsights({ status: 'NO_DATA', sourcePeriod: null, sourceMonth, forecastMonth, coverage, comparison, inspections, recommendations: [{ key: 'COVERAGE', priority: 'LOW', title: 'Complete the water-reading history', condition: 'No eligible actual billing month is available.', action: 'Record and validate monthly meter readings, then refresh forecasts in Water Analytics.' }] });
  }

  // A source snapshot can contain only one forecast per unit. Defensive ordering
  // also makes legacy duplicate input deterministic and excludes other origins.
  const forecastMap = new Map();
  for (const forecast of [...forecasts].sort((a, b) => String(b.generatedAt || '').localeCompare(String(a.generatedAt || '')) || Number(b.id || 0) - Number(a.id || 0))) {
    if (String(forecast.basedOnPeriodId) !== String(source.id) || date(forecast.forecastForMonth) !== forecastMonth) continue;
    const key = String(forecast.unitId);
    if (!forecastMap.has(key)) forecastMap.set(key, forecast);
  }
  // One reading per unit/month, bounded to this source. Prefer the exact source
  // snapshot in its month, otherwise the latest period and ID in that month.
  const histories = new Map();
  for (const row of [...history].sort((a, b) => date(a.periodStart).localeCompare(date(b.periodStart)) || Number(a.billingPeriodId || 0) - Number(b.billingPeriodId || 0))) {
    if (date(row.periodStart) > date(source.periodStart)) continue;
    const key = String(row.unitId),month = date(row.periodStart).slice(0, 7);
    if (!histories.has(key)) histories.set(key, new Map());
    const months = histories.get(key),previous = months.get(month);
    if (previous && String(previous.billingPeriodId) === String(source.id) && String(row.billingPeriodId) !== String(source.id)) continue;
    months.set(month, row);
  }
  let actualTotal = 0,projectedTotal = 0;
  for (const [key, unit] of unitMap) {
    const forecast = forecastMap.get(key);
    const readings = [...(histories.get(key)?.values() || [])].sort((a, b) => date(a.periodStart).localeCompare(date(b.periodStart)));
    const actual = readings.find((row) => String(row.billingPeriodId) === String(source.id));
    const actualValue = actual?.validationStatus === 'VALID' ? adminWaterGuidanceNumber(actual.consumption) : null;
    const predicted = forecast?.status === 'READY' ? adminWaterGuidanceNumber(forecast.predictedConsumption) : null;
    if (!forecast) coverage.missingForecastUnits++;else
    if (forecast.status === 'INSUFFICIENT_DATA') coverage.insufficientHistoryUnits++;else
    if (forecast.status === 'FLAGGED_READING') coverage.flaggedUnits++;else
    if (predicted === null) coverage.invalidForecastUnits++;
    if (predicted !== null) {
      coverage.readyUnits++;
      if (actualValue !== null) {
        coverage.comparableUnits++;
        actualTotal += actualValue;
        projectedTotal += predicted;
      }
    }
    if (actualValue === null) coverage.missingActualUnits++;
    // Do not diagnose a vacant unit from a stale reading in an older month.
    const rules = buildPrescriptiveRecommendations({
      forecast: forecast || { status: 'INSUFFICIENT_DATA', sampleCount: 0 },
      history: actual ? readings : [], context: { occupancyStatus: unit.occupancyStatus }
    });
    const types = new Set(rules.map((rule) => rule.recommendationType));
    const high = types.has(RECOMMENDATION_TYPES.CHECK_HIGH_USAGE);
    const vacant = types.has(RECOMMENDATION_TYPES.VACANT_UNIT_USAGE);
    const flagged = types.has(RECOMMENDATION_TYPES.REVIEW_METER_READING);
    if (high) inspections.highUsageUnits++;
    if (vacant) inspections.vacantUsageUnits++;
    if (flagged) inspections.flaggedReadingUnits++;
    if (high || vacant || flagged) inspections.unitCount++;
  }
  if (coverage.comparableUnits) {
    comparison.actualConsumption = adminWaterGuidanceRounded(actualTotal);
    comparison.projectedConsumption = adminWaterGuidanceRounded(projectedTotal);
    if (rate !== null && rate > 0) {
      comparison.actualWaterCharge = adminWaterGuidanceRounded(actualTotal * rate, 2);
      comparison.projectedWaterCharge = adminWaterGuidanceRounded(projectedTotal * rate, 2);
    }
    if (actualTotal > 0) {
      const change = (projectedTotal - actualTotal) / actualTotal;
      comparison.changePercent = adminWaterGuidanceRounded(change * 100, 2);
      comparison.direction = change >= HIGH_USAGE_THRESHOLD - 1e-12 ? 'INCREASE' : change <= -HIGH_USAGE_THRESHOLD + 1e-12 ? 'DECREASE' : 'STABLE';
    }
  }
  const comparable = unitLabel(coverage.comparableUnits);
  if (comparison.direction === 'UNAVAILABLE') {
    recommendations.push({ key: 'TREND', priority: 'LOW', title: 'Verify the comparison data', condition: coverage.comparableUnits ? `The latest actual consumption is zero for the ${comparable} with comparable forecasts; a percentage change is unavailable.` : 'No units have both a ready forecast and valid actual readings from the source period.', action: 'Complete or verify source readings and refresh forecasts before drawing a building-wide trend conclusion.' });
  } else {
    const direction = comparison.direction;
    recommendations.push({ key: 'TREND', priority: direction === 'INCREASE' ? 'HIGH' : 'LOW', title: direction === 'INCREASE' ? 'Prioritize water-use checks' : direction === 'DECREASE' ? 'Monitor the projected decrease' : 'Continue monthly monitoring',
      condition: `Forecast consumption is ${Math.abs(comparison.changePercent).toFixed(1)}% ${comparison.changePercent >= 0 ? 'above' : 'below'} the previous month for the same ${comparable}.`,
      action: direction === 'INCREASE' ? 'Ask the Billing Associate to review units with high projected consumption and coordinate checks before the next meter-reading cycle.' : direction === 'DECREASE' ? 'Confirm the next actual meter readings and continue reviewing individual unit warnings.' : 'Continue the monthly meter-reading schedule and review individual unit warnings.' });
  }
  if (inspections.unitCount) {
    recommendations.push({ key: 'INSPECTIONS', priority: 'HIGH', title: `Review ${unitLabel(inspections.unitCount)}`, condition: `${inspections.highUsageUnits} with high projected consumption; ${inspections.vacantUsageUnits} with usage while vacant; ${inspections.flaggedReadingUnits} with flagged readings. A unit may appear in more than one category.`, action: 'Ask the Billing Associate to verify flagged readings and coordinate inspections of vacant or high-usage units. These warnings do not confirm a leak.' });
  }
  const excluded = coverage.totalUnits - coverage.readyUnits;
  const coverageReasons = [
  [coverage.missingForecastUnits, 'missing forecasts'], [coverage.insufficientHistoryUnits, 'with insufficient history'],
  [coverage.flaggedUnits, 'with flagged forecasts'], [coverage.invalidForecastUnits, 'with other unusable forecasts']].
  filter(([count]) => count > 0).map(([count, label]) => `${count} ${label}`).join('; ');
  recommendations.push({ key: 'COVERAGE', priority: 'LOW', title: excluded || coverage.missingActualUnits ? 'Complete the forecast coverage' : 'Maintain the reading history',
    condition: `${coverage.readyUnits} of ${coverage.totalUnits} units have ready forecasts; ${coverage.comparableUnits} have comparable actual readings.${coverageReasons ? ` Excluded: ${coverageReasons}.` : ''}`,
    action: excluded || coverage.missingActualUnits ? `Collect or correct missing readings and refresh forecasts in Water Analytics. ${excluded ? 'This forecast does not represent every unit.' : 'The trend comparison does not cover every unit.'}` : 'Continue recording and validating monthly readings to keep forecasts up to date.' });
  return withChartInsights({ status: coverage.comparableUnits ? 'READY' : 'NO_COMPARISON', sourcePeriod: { id: source.id, periodStart: date(source.periodStart), periodEnd: date(source.periodEnd), periodType: source.periodType, waterRate: rate }, sourceMonth, forecastMonth, coverage, comparison, inspections, recommendations });
}

export async function loadAdminWaterGuidance(client, history) {
  const [periodResult, unitsResult] = await Promise.all([
  client.query(`SELECT p.id, p.period_start AS "periodStart", p.period_end AS "periodEnd", p.period_type AS "periodType", p.water_rate_per_cubic_m AS "waterRate"
      FROM billing_periods p WHERE ${analyticsPeriodCondition('p')}
        AND EXISTS (SELECT 1 FROM meter_readings m WHERE m.billing_period_id = p.id)
      ORDER BY p.period_start DESC, p.id DESC LIMIT 1`),
  client.query('SELECT id, unit_number AS "unitNumber", occupancy_status AS "occupancyStatus" FROM units ORDER BY id')]
  );
  const source = periodResult.rows[0] || null;
  const forecasts = source ? await client.query(`SELECT f.id, f.unit_id AS "unitId", f.based_on_period_id AS "basedOnPeriodId", f.forecast_for_month AS "forecastForMonth",
    f.forecast_status AS status, f.predicted_consumption AS "predictedConsumption", f.sample_count AS "sampleCount", f.status_reason AS reason, f.generated_at AS "generatedAt"
    FROM billing_forecasts f WHERE f.based_on_period_id = $1 AND f.forecast_for_month = $2::date`, [source.id, nextMonthStart(source.periodStart)]) : { rows: [] };
  return buildAdminWaterGuidance({ source, units: unitsResult.rows, forecasts: forecasts.rows, history });
}

// #endregion

// #region Transactional forecast refresh

export async function refreshAnalyticsForecasts(pool, {
  generate = regenerateForecasts, recommend = regeneratePrescriptiveRecommendations, actorUserId = null,
} = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Chronological rebuild and recommendations share a single transaction.
    const periods = await client.query(`SELECT p.id FROM billing_periods p
      WHERE ${analyticsPeriodCondition('p')} ORDER BY p.period_start FOR UPDATE`);
    for (const period of periods.rows) await generate(client, period.id);
    if (periods.rows.length) {
      await recommend(client);
      await writeAuditLog({ client, actorUserId, entityName: 'ANALYTICS', action: 'REFRESH_FORECASTS', newValues: { periodCount: periods.rows.length, forecastsRefreshed: true, recommendationsRefreshed: true }, context: { target: { label: 'Water forecasts and recommendations' }, affectedRecords: periods.rows.map(row => ({ entityName: 'BILLING_PERIOD', entityId: row.id })) } });
    }
    await client.query('COMMIT');
    return { periodCount: periods.rows.length };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

// #endregion
