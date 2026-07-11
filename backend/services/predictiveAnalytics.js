const WINDOW_SIZE = 5;

function numeric(value) {
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

export function selectConsecutiveReadings(history, windowSize = WINDOW_SIZE) {
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

export function buildForecast(history, { waterRate = 0, windowSize = WINDOW_SIZE } = {}) {
  const sorted = [...(history || [])].sort((a, b) => monthIndex(a.periodStart) - monthIndex(b.periodStart));
  const latest = sorted.at(-1);
  if (!latest) {
    return { status: "INSUFFICIENT_DATA", reason: "No meter readings are available.", sampleCount: 0 };
  }
  if (latest.validationStatus !== "VALID") {
    return { status: "FLAGGED_READING", reason: "The latest meter reading requires review.", sampleCount: 0 };
  }
  const selected = selectConsecutiveReadings(sorted, windowSize);
  if (selected.length < windowSize) {
    return {
      status: "INSUFFICIENT_DATA",
      reason: `At least ${windowSize} consecutive valid monthly readings are required.`,
      sampleCount: selected.length,
    };
  }
  const regression = linearRegression(selected.map((reading) => reading.consumption));
  const predictedConsumption = Number(regression.predicted.toFixed(3));
  return {
    status: "READY",
    reason: null,
    sampleCount: selected.length,
    predictedConsumption,
    estimatedWaterCharge: Number((predictedConsumption * numeric(waterRate || 0)).toFixed(2)),
    slope: regression.slope,
    intercept: regression.intercept,
  };
}

export function calculateAccuracy(rows) {
  const evaluated = (rows || []).filter((row) => {
    const predicted = numeric(row.predictedConsumption);
    const actual = numeric(row.actualConsumption);
    return predicted !== null && actual !== null && actual >= 0;
  });
  if (evaluated.length === 0) return { evaluatedCount: 0, mae: null, rmse: null, wape: null, accuracy: null };
  const errors = evaluated.map((row) => Math.abs(Number(row.predictedConsumption) - Number(row.actualConsumption)));
  const actualTotal = evaluated.reduce((sum, row) => sum + Number(row.actualConsumption), 0);
  const mae = errors.reduce((sum, error) => sum + error, 0) / errors.length;
  const rmse = Math.sqrt(errors.reduce((sum, error) => sum + (error ** 2), 0) / errors.length);
  const wape = actualTotal > 0 ? errors.reduce((sum, error) => sum + error, 0) / actualTotal : null;
  return {
    evaluatedCount: evaluated.length,
    mae: Number(mae.toFixed(3)),
    rmse: Number(rmse.toFixed(3)),
    wape: wape === null ? null : Number((wape * 100).toFixed(2)),
    accuracy: wape === null ? null : Number((Math.max(0, 1 - wape) * 100).toFixed(2)),
  };
}

export async function regenerateForecasts(client, billingPeriodId) {
  const periodResult = await client.query(
    `SELECT id, period_start AS "periodStart", water_rate_per_cubic_m AS "waterRate"
     FROM billing_periods WHERE id = $1`,
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
     WHERE p.period_start <= $1
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
    const forecast = buildForecast(historyByUnit.get(Number(unit.id)) || [], { waterRate: period.waterRate });
    await client.query(
      `INSERT INTO billing_forecasts
        (unit_id, based_on_period_id, forecast_for_month, predicted_consumption,
         estimated_water_charge, sample_count, slope, intercept, forecast_status, status_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [unit.id, billingPeriodId, forecastMonth, forecast.predictedConsumption ?? null,
        forecast.estimatedWaterCharge ?? null, forecast.sampleCount, forecast.slope ?? null,
        forecast.intercept ?? null, forecast.status, forecast.reason],
    );
  }
}

export async function regenerateForecastsFromPeriod(client, billingPeriodId) {
  const periods = await client.query(
    `SELECT id FROM billing_periods
     WHERE period_start >= (SELECT period_start FROM billing_periods WHERE id = $1)
     ORDER BY period_start`,
    [billingPeriodId],
  );
  for (const period of periods.rows) await regenerateForecasts(client, period.id);
}

export { WINDOW_SIZE };
