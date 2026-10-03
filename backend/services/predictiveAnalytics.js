import { analyticsPeriodCondition } from './analyticsPeriods.js';

// Keep model training bounded and preserve the five-reading eligibility rule.
const MIN_WINDOW_SIZE = 5;
const MAX_WINDOW_SIZE = 12;
const WINDOW_SIZE = MAX_WINDOW_SIZE;
// Promote only after a connected-history comparison passes every acceptance gate.
export const ACTIVE_FORECAST_POLICY = 'revised';

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

  const selectModel = policy === 'revised' ? selectForecastModel : selectLegacyForecastModel;
  const model = selectModel(selected.map((reading) => reading.consumption));
  if (!model) return { status: 'INSUFFICIENT_DATA', reason: 'Valid numeric readings are required.', sampleCount: selected.length };
  const predictedConsumption = Number(model.predicted.toFixed(3));

  return {
    status: "READY",
    reason: null,
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
