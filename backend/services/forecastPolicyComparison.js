import { buildForecast, calculateAccuracy, monthIndex, nextMonthStart } from './predictiveAnalytics.js';

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
