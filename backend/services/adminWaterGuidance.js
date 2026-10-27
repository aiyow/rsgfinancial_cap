import { analyticsPeriodCondition } from './analyticsPeriods.js';
import { nextMonthStart } from './predictiveAnalytics.js';
import { buildPrescriptiveRecommendations, HIGH_USAGE_THRESHOLD, RECOMMENDATION_TYPES } from './prescriptiveAnalytics.js';

function number(value) {
  if (value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

const date = value => String(value || '').slice(0, 10);
const rounded = (value, decimals = 3) => Number(value.toFixed(decimals));
const unitLabel = count => `${count} ${count === 1 ? 'unit' : 'units'}`;
const money = value => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const volume = value => new Intl.NumberFormat('en-PH', { maximumFractionDigits: 3 }).format(value);

// The charts share a comparable cohort, but prescribe different decisions:
// meter/usage work for consumption, and charge/rate validation for billing.
function withChartInsights(guidance) {
  const { sourcePeriod, comparison, coverage, recommendations } = guidance;
  const consumption = [], bill = [];
  if (!sourcePeriod) {
    consumption.push({ key: 'USAGE_HISTORY', priority: 'LOW', title: 'Establish the water-use history', condition: 'No eligible actual consumption month is available.', action: 'Record and validate consecutive monthly meter readings to establish a water-use forecast.' });
    bill.push({ key: 'BILLING_INPUTS', priority: 'LOW', title: 'Prepare the water-charge forecast', condition: 'No source billing period is available for a charge estimate.', action: 'Confirm the approved water rate and establish valid reading history before preparing projected resident water charges.' });
    return { ...guidance, chartInsights: { consumption, bill } };
  }
  const usageTrend = recommendations.find(item => item.key === 'TREND');
  if (usageTrend) {
    const hasVolumes = comparison.actualConsumption !== null && comparison.projectedConsumption !== null;
    const difference = hasVolumes ? rounded(comparison.projectedConsumption - comparison.actualConsumption) : null;
    const condition = hasVolumes
      ? `Projected water use ${difference === 0 ? 'is unchanged' : `${difference > 0 ? 'increases' : 'decreases'} by ${volume(Math.abs(difference))} m³`} for the same ${unitLabel(coverage.comparableUnits)}.${comparison.changePercent === null ? ' A percentage comparison is unavailable because the actual baseline is zero.' : ` Change from the latest actual month: ${comparison.changePercent > 0 ? '+' : ''}${comparison.changePercent.toFixed(2)}%.`}`
      : 'No units have both a ready water-use forecast and valid actual consumption in the source period.';
    consumption.push({ ...usageTrend, key: 'USAGE_TREND', condition });
  }
  const inspections = recommendations.find(item => item.key === 'INSPECTIONS');
  if (inspections) consumption.push({ ...inspections, key: 'USAGE_INSPECTIONS' });

  const validRate = sourcePeriod.waterRate !== null && sourcePeriod.waterRate > 0;
  const hasCharges = comparison.actualWaterCharge !== null && comparison.projectedWaterCharge !== null;
  if (!validRate) {
    bill.push({ key: 'BILLING_RATE', priority: 'HIGH', title: 'Set a valid water rate before estimating charges', condition: 'Water-charge estimates are unavailable because the source period has no valid positive water rate.', action: 'Have the Billing Associate verify the water rate in the source billing period, then refresh the forecasts before preparing water charges.' });
  } else {
    if (hasCharges) {
      const difference = rounded(comparison.projectedWaterCharge - comparison.actualWaterCharge, 2);
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
  const unitMap = new Map(units.map(unit => [String(unit.id), unit]));
  const sourceMonth = source ? `${date(source.periodStart).slice(0, 7)}-01` : null;
  const forecastMonth = source ? nextMonthStart(source.periodStart) : null;
  const rate = number(source?.waterRate);
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
    const key = String(row.unitId), month = date(row.periodStart).slice(0, 7);
    if (!histories.has(key)) histories.set(key, new Map());
    const months = histories.get(key), previous = months.get(month);
    if (previous && String(previous.billingPeriodId) === String(source.id) && String(row.billingPeriodId) !== String(source.id)) continue;
    months.set(month, row);
  }
  let actualTotal = 0, projectedTotal = 0;
  for (const [key, unit] of unitMap) {
    const forecast = forecastMap.get(key);
    const readings = [...(histories.get(key)?.values() || [])].sort((a, b) => date(a.periodStart).localeCompare(date(b.periodStart)));
    const actual = readings.find(row => String(row.billingPeriodId) === String(source.id));
    const actualValue = actual?.validationStatus === 'VALID' ? number(actual.consumption) : null;
    const predicted = forecast?.status === 'READY' ? number(forecast.predictedConsumption) : null;
    if (!forecast) coverage.missingForecastUnits++;
    else if (forecast.status === 'INSUFFICIENT_DATA') coverage.insufficientHistoryUnits++;
    else if (forecast.status === 'FLAGGED_READING') coverage.flaggedUnits++;
    else if (predicted === null) coverage.invalidForecastUnits++;
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
      history: actual ? readings : [], context: { occupancyStatus: unit.occupancyStatus },
    });
    const types = new Set(rules.map(rule => rule.recommendationType));
    const high = types.has(RECOMMENDATION_TYPES.CHECK_HIGH_USAGE);
    const vacant = types.has(RECOMMENDATION_TYPES.VACANT_UNIT_USAGE);
    const flagged = types.has(RECOMMENDATION_TYPES.REVIEW_METER_READING);
    if (high) inspections.highUsageUnits++;
    if (vacant) inspections.vacantUsageUnits++;
    if (flagged) inspections.flaggedReadingUnits++;
    if (high || vacant || flagged) inspections.unitCount++;
  }
  if (coverage.comparableUnits) {
    comparison.actualConsumption = rounded(actualTotal);
    comparison.projectedConsumption = rounded(projectedTotal);
    if (rate !== null && rate > 0) {
      comparison.actualWaterCharge = rounded(actualTotal * rate, 2);
      comparison.projectedWaterCharge = rounded(projectedTotal * rate, 2);
    }
    if (actualTotal > 0) {
      const change = (projectedTotal - actualTotal) / actualTotal;
      comparison.changePercent = rounded(change * 100, 2);
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
    [coverage.flaggedUnits, 'with flagged forecasts'], [coverage.invalidForecastUnits, 'with other unusable forecasts'],
  ].filter(([count]) => count > 0).map(([count, label]) => `${count} ${label}`).join('; ');
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
    client.query('SELECT id, unit_number AS "unitNumber", occupancy_status AS "occupancyStatus" FROM units ORDER BY id'),
  ]);
  const source = periodResult.rows[0] || null;
  const forecasts = source ? await client.query(`SELECT f.id, f.unit_id AS "unitId", f.based_on_period_id AS "basedOnPeriodId", f.forecast_for_month AS "forecastForMonth",
    f.forecast_status AS status, f.predicted_consumption AS "predictedConsumption", f.sample_count AS "sampleCount", f.status_reason AS reason, f.generated_at AS "generatedAt"
    FROM billing_forecasts f WHERE f.based_on_period_id = $1 AND f.forecast_for_month = $2::date`, [source.id, nextMonthStart(source.periodStart)]) : { rows: [] };
  return buildAdminWaterGuidance({ source, units: unitsResult.rows, forecasts: forecasts.rows, history });
}
