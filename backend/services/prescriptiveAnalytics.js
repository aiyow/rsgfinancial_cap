import { selectConsecutiveReadings, WINDOW_SIZE } from './predictiveAnalytics.js';

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
      'Ask the collector to recheck the meter reading and upload a meter photo before it is used for billing or forecasting.',
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
    const validWindow = selectConsecutiveReadings(history, WINDOW_SIZE);
    const sampleCount = Math.min(Number(forecast.sampleCount ?? validWindow.length) || 0, WINDOW_SIZE);
    const missingMonths = Math.max(WINDOW_SIZE - sampleCount, 1);
    recommendations.push(action(
      RECOMMENDATION_TYPES.COLLECT_MORE_HISTORY,
      'MEDIUM',
      `Only ${sampleCount} of the required ${WINDOW_SIZE} consecutive valid monthly readings are available.`,
      `Record ${missingMonths} more consecutive valid monthly meter reading${missingMonths === 1 ? '' : 's'} before relying on a forecast.`,
      { sampleCount, missingMonths, requiredMonths: WINDOW_SIZE },
    ));
  }

  if (validThree.length === 3 && validThree.every((reading, index) => index === 0
    || number(reading.consumption) > number(validThree[index - 1].consumption))) {
    recommendations.push(action(
      RECOMMENDATION_TYPES.RISING_CONSUMPTION,
      'MEDIUM',
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
            'MEDIUM',
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
      'MEDIUM',
      `An unpaid balance of PHP ${rounded(remainingBalance, 2).toFixed(2)} is due in ${days} day${days === 1 ? '' : 's'}.`,
      'Send an in-app payment reminder to the assigned payer with the due date and remaining balance.',
      { remainingBalance: rounded(remainingBalance, 2), dueDate: context.dueDate, daysUntilDue: days },
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
      'MEDIUM',
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
      priority VARCHAR(20) NOT NULL CHECK (priority IN ('HIGH', 'MEDIUM')),
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
     FROM billing_periods p WHERE p.period_type = 'LIVE_BILLING'
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
       WHERE p.period_start <= $1 ORDER BY m.unit_id, p.period_start`, [period.periodStart],
    ),
    client.query(
      `SELECT b.unit_id AS "unitId", b.due_date_snapshot AS "dueDate",
        GREATEST(COALESCE(SUM(c.quantity * c.rate_applied), 0) - COALESCE((
          SELECT SUM(pa.amount_applied) FROM payment_applications pa WHERE pa.unit_bill_id = b.id
        ), 0), 0) AS "remainingBalance"
       FROM unit_bills b LEFT JOIN bill_charges c ON c.unit_bill_id = b.id
       WHERE b.billing_period_id = $1 GROUP BY b.id`, [period.id],
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
      context: { occupancyStatus: forecast.occupancyStatus, dueDate: bill?.dueDate, remainingBalance: bill?.remainingBalance },
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
