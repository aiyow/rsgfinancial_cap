import { readFile, writeFile } from 'node:fs/promises';
import { benchmarkDataset } from '../services/forecastEvaluation.js';
import { buildForecast, calculateAccuracy, forecastCandidates, selectConsecutiveReadings, selectForecastModel } from '../services/predictiveAnalytics.js';

// Reads only a previously captured local dataset; never updates live forecasts.
const artifact = (name) => new URL(`../../artifacts/${name}`, import.meta.url);
const dataset = JSON.parse(await readFile(artifact('forecast-connected-dataset.json'), 'utf8'));
const report = benchmarkDataset(dataset);
const byUnit = new Map();
for (const reading of dataset.readings) {
  const key = String(reading.unitId);
  if (!byUnit.has(key)) byUnit.set(key, []);
  byUnit.get(key).push(reading);
}
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const stablePrediction = (values) => {
  const candidates = forecastCandidates(values).filter((row) => ['LAST_MONTH_CONSUMPTION', 'RECENT_3_MONTH_AVERAGE', 'RECENT_5_MONTH_MEDIAN'].includes(row.name));
  return candidates.reduce((sum, row) => sum + row.predicted, 0) / candidates.length;
};
function guardedPrediction(values) {
  if (values.length < 7) return selectForecastModel(values).predicted;
  const candidates = forecastCandidates(values);
  const errors = new Map(candidates.map((row) => [row.name, { absolute: 0, squared: 0 }]));
  let stableAbsolute = 0;
  let stableSquared = 0;
  for (let target = 5; target < values.length; target += 1) {
    const training = values.slice(0, target);
    const stableError = stablePrediction(training) - values[target];
    stableAbsolute += Math.abs(stableError);
    stableSquared += stableError ** 2;
    for (const candidate of forecastCandidates(training)) {
      const score = errors.get(candidate.name);
      const error = candidate.predicted - values[target];
      score.absolute += Math.abs(error);
      score.squared += error ** 2;
    }
  }
  const supported = candidates.filter((row) => errors.get(row.name).absolute < stableAbsolute * 0.8
    && errors.get(row.name).squared <= stableSquared).sort((a, b) => errors.get(a.name).absolute - errors.get(b.name).absolute);
  return supported[0]?.predicted ?? stablePrediction(values);
}
const savedByPair = new Map((dataset.savedForecasts || []).map((row) => [`${row.unitId}:${row.forecastForMonth}`, row]));
const pairs = report.pairs.flatMap((pair) => {
  const saved = savedByPair.get(`${pair.unitId}:${pair.forecastForMonth}`);
  if (saved?.status !== 'READY' || saved.predictedConsumption === null || saved.predictedConsumption === undefined
    || String(saved.predictedConsumption).trim() === '' || !Number.isFinite(Number(saved.predictedConsumption))
    || Number(saved.predictedConsumption) < 0) return [];
  const readings = byUnit.get(String(pair.unitId)).filter((row) => row.periodStart <= pair.sourceMonth);
  const values = selectConsecutiveReadings(readings).map((row) => Number(row.consumption));
  const candidates = forecastCandidates(values);
  const selected = selectForecastModel(values);
  const stable = candidates.filter((row) => ['LAST_MONTH_CONSUMPTION', 'RECENT_3_MONTH_AVERAGE', 'RECENT_5_MONTH_MEDIAN'].includes(row.name));
  return [{ ...pair, values, savedModel: saved.modelName, predictions: {
    ...pair.predictions,
    saved: Number(saved.predictedConsumption),
    ensembleMedian: median(candidates.map((row) => row.predicted)),
    stableAverage: stable.reduce((sum, row) => sum + row.predicted, 0) / stable.length,
    selectedStableBlend: (selected.predicted + stable.reduce((sum, row) => sum + row.predicted, 0) / stable.length) / 2,
    stableAfterWarmup: values.length < 7 ? selected.predicted : stablePrediction(values),
    guarded: guardedPrediction(values),
    stablePolicy: buildForecast(readings, { sourceMonth: pair.sourceMonth, policy: 'stable' }).predictedConsumption,
  } }];
});
if (!pairs.length) throw new Error('No valid saved forecast/actual pairs are available for comparison.');
const methods = Object.keys(pairs[0].predictions);
const metrics = (rows) => Object.fromEntries(methods.map((method) => [method, calculateAccuracy(rows.map((row) => ({ actualConsumption: row.actualConsumption, predictedConsumption: row.predictions[method] })))]));
const monthly = report.monthly.filter((row) => row.evaluatedCount).map((row) => {
  const monthlyPairs = pairs.filter((pair) => pair.forecastForMonth === row.forecastForMonth);
  const actualTotal = monthlyPairs.reduce((sum, pair) => sum + pair.actualConsumption, 0);
  const absoluteErrorTotal = monthlyPairs.reduce((sum, pair) => sum + Math.abs(pair.predictions.saved - pair.actualConsumption), 0);
  const topErrors = monthlyPairs.map((pair) => ({ unitNumber: pair.unitNumber, actual: pair.actualConsumption, predicted: pair.predictions.saved,
    absoluteError: Math.abs(pair.predictions.saved - pair.actualConsumption), history: pair.values, model: pair.savedModel }))
    .sort((a, b) => b.absoluteError - a.absoluteError).slice(0, 10);
  return { month: row.forecastForMonth, evaluatedCount: monthlyPairs.length, excludedCount: row.excludedCount, actualTotal, absoluteErrorTotal,
    topErrors, metrics: metrics(monthlyPairs) };
});
const latest = monthly.at(-1);
const previous = monthly.at(-2);
const commonIds = new Set(pairs.filter((row) => row.forecastForMonth === previous.month).map((row) => String(row.unitId)));
const commonLatest = pairs.filter((row) => row.forecastForMonth === latest.month && commonIds.has(String(row.unitId)));
const savedMetrics = calculateAccuracy(pairs.map((row) => ({ actualConsumption: row.actualConsumption, predictedConsumption: row.predictions.saved })), { round: false });
const stableMetrics = calculateAccuracy(pairs.map((row) => ({ actualConsumption: row.actualConsumption, predictedConsumption: row.predictions.stablePolicy })), { round: false });
const acceptance = { passed: pairs.length > 0 && stableMetrics.mae < savedMetrics.mae && stableMetrics.wape < savedMetrics.wape
  && stableMetrics.rmse <= savedMetrics.rmse, rule: 'Lower aggregate MAE and WAPE without increasing RMSE on identical saved forecast/actual pairs.' };
const output = { capturedAt: dataset.capturedAt, aggregate: metrics(pairs), monthly, commonLatest: metrics(commonLatest), acceptance, pairs };
await writeFile(artifact('forecast-accuracy-investigation.json'), JSON.stringify(output, null, 2));
const metricLine = (label, row) => `| ${label} | ${row.mae.toFixed(3)} | ${row.rmse.toFixed(3)} | ${row.wape.toFixed(2)}% | ${row.accuracy.toFixed(2)}% |`;
const text = [
  '# September forecast accuracy investigation', '',
  `Connected data captured ${dataset.capturedAt}. January–August historical imports and September live billing (period starts September 5) are included. Database capture was read-only.`, '',
  '## Cause of the score drop', '',
  `August: ${previous.actualTotal.toFixed(3)} m³ actual consumption and ${previous.absoluteErrorTotal.toFixed(3)} m³ absolute forecast error. September: ${latest.actualTotal.toFixed(3)} m³ and ${latest.absoluteErrorTotal.toFixed(3)} m³. Actual consumption fell ${(100 * (1 - latest.actualTotal / previous.actualTotal)).toFixed(2)}%; absolute error rose ${(100 * (latest.absoluteErrorTotal / previous.absoluteErrorTotal - 1)).toFixed(2)}%.`, '',
  `Restricting September to the ${commonLatest.length} units also evaluated in August gives ${output.commonLatest.saved.wape.toFixed(2)}% WAPE, versus ${latest.metrics.saved.wape.toFixed(2)}% across all ${latest.evaluatedCount} units. Coverage changes explain very little of the score drop.`, '',
  '| Unit | September forecast (m³) | Actual (m³) | Absolute error (m³) |',
  '| --- | ---: | ---: | ---: |',
  ...latest.topErrors.slice(0, 5).map((row) => `| ${row.unitNumber} | ${row.predicted.toFixed(3)} | ${row.actual.toFixed(3)} | ${row.absoluteError.toFixed(3)} |`), '',
  'Unit 503 used below 1.35 m³ in each earlier month, then 40.052 m³ in September. Units 307 and 306 went from regular positive use to zero. These changes warrant checking readings and occupancy, but remain valid observations in the evaluation; no reading was changed or removed.', '',
  '## Policy comparison', '',
  `All rows below use the same ${pairs.length} eligible unit/month pairs, with chronological cutoffs. Predictions for September use only readings through August. All results are retrospective development comparisons on this dataset, not independent future validation.`, '',
  '| Policy | MAE (m³) | RMSE (m³) | WAPE error | Derived accuracy |',
  '| --- | ---: | ---: | ---: | ---: |',
  metricLine('Saved current policy', output.aggregate.saved),
  metricLine('New stable policy', output.aggregate.stablePolicy),
  metricLine('Last-month baseline', output.aggregate.lastMonth),
  metricLine('Three-month-average baseline', output.aggregate.recentAverage), '',
  `Acceptance gate: **${acceptance.passed ? 'passed' : 'failed'}**, using unrounded scores. ${acceptance.rule}`, '',
  '| Month | Evaluated / excluded | Saved accuracy | New accuracy | Saved RMSE (m³) | New RMSE (m³) |',
  '| --- | ---: | ---: | ---: | ---: | ---: |',
  ...monthly.map((row) => `| ${row.month.slice(0, 7)} | ${row.evaluatedCount} / ${row.excludedCount} | ${row.metrics.saved.accuracy.toFixed(2)}% | ${row.metrics.stablePolicy.accuracy.toFixed(2)}% | ${row.metrics.saved.rmse.toFixed(3)} | ${row.metrics.stablePolicy.rmse.toFixed(3)} |`), '',
  'The stable policy retains five consecutive valid readings, the twelve-month maximum, and full-window regression until two earlier comparison months exist. After that, irregular usage blends last-month consumption, recent-three-month average, and recent-five-month median equally. Exact linear trends still use regression. Legacy and adaptive policies remain available in code. Real zero readings, missing values, flagged readings, and month gaps keep their existing treatment.', '',
  'An ungated blend also performed better in aggregate, but would change the established five/six-reading regression fallback. It was not promoted. A candidate-selection guard improved aggregate scores only slightly and worsened September, so it was not promoted either. The JSON records all tested variants.', '',
  '## Corrections and visibility', '',
  'The benchmark now matches actuals by calendar month, so a live period starting on the fifth is included. Dashboard evaluation now includes same-pair actual/error totals and the five largest unit errors with shares of total error. Stored historical forecasts can be rebuilt through the existing transactional refresh, producing retrospective scores and updating dependent recommendations. Actual bills and meter readings are unaffected.', '',
  'Reproduce from backend: `node scripts/benchmarkForecasts.js --updated`, then `node scripts/investigateForecastAccuracy.js`. Capturing again replaces the connected snapshot; preserve this run before a live forecast refresh if comparing against these original saved predictions.', '',
];
await writeFile(artifact('forecast-accuracy-investigation.md'), text.join('\n'));
console.log(JSON.stringify({ aggregate: { saved: output.aggregate.saved, stable: output.aggregate.stablePolicy },
  monthly: monthly.map((row) => ({ month: row.month, evaluatedCount: row.evaluatedCount, saved: row.metrics.saved, stable: row.metrics.stablePolicy })),
  commonLatest: output.commonLatest.saved, acceptance }, null, 2));
