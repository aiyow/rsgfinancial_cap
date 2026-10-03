import { buildForecast, calculateAccuracy, forecastCandidates, nextMonthStart, selectConsecutiveReadings } from './predictiveAnalytics.js';
import { summarizeUsageReview } from './usageChangeReview.js';

function validNumber(value) {
  return value !== null && value !== undefined && typeof value !== 'boolean'
    && !(typeof value === 'string' && value.trim() === '') && Number.isFinite(Number(value)) && Number(value) >= 0;
}

function monthStart(value) {
  return `${String(value).slice(0, 7)}-01`;
}

export function validEvaluationPair(row) {
  return row.status === 'READY' && row.actualValidationStatus === 'VALID'
    && validNumber(row.predictedConsumption) && validNumber(row.actualConsumption);
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
    recentAverage: candidates.find((candidate) => candidate.name === 'RECENT_3_MONTH_AVERAGE').predicted,
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
      errorShare: absoluteErrorTotal > 0
        ? Number((Math.abs(Number(row.predictedConsumption) - Number(row.actualConsumption)) / absoluteErrorTotal * 100).toFixed(2)) : 0,
    })).sort((a, b) => b.absoluteError - a.absoluteError || String(a.unitId).localeCompare(String(b.unitId))).slice(0, 5);
    return { forecastForMonth, evaluationType: 'RETROSPECTIVE', metrics,
      totals: { actualConsumption: Number(actualTotal.toFixed(3)), absoluteError: Number(absoluteErrorTotal.toFixed(3)) },
      topErrorUnits,
      usageReview: summarizeUsageReview(paired, byUnit),
      baselines: {
        lastMonth: calculateAccuracy(paired.map((row) => ({ ...row, predictedConsumption: row.baselines.lastMonth }))),
        recentAverage: calculateAccuracy(paired.map((row) => ({ ...row, predictedConsumption: row.baselines.recentAverage }))),
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
      if (!actual || actual.validationStatus !== 'VALID' || !validNumber(actual.consumption)
        || current.status !== 'READY' || !validNumber(current.predictedConsumption)
        || revised.status !== 'READY' || !baselines) continue;
      evaluatedCount += 1;
      pairs.push({ unitId: unit.unitId, unitNumber: unit.unitNumber, forecastForMonth: targetMonth,
        actualConsumption: Number(actual.consumption), sourceMonth: period.periodStart,
        predictions: { current: current.predictedConsumption, revised: revised.predictedConsumption,
          lastMonth: baselines.lastMonth, recentAverage: baselines.recentAverage },
        models: { current: current.modelName, revised: revised.modelName },
      });
    }
    coverage.push({ forecastForMonth: targetMonth, evaluatedCount, excludedCount: dataset.units.length - evaluatedCount });
  }
  const methods = ['current', 'revised', 'lastMonth', 'recentAverage'];
  const score = (rows, method, round = true) => calculateAccuracy(rows.map((row) => ({
    actualConsumption: row.actualConsumption, predictedConsumption: row.predictions[method],
  })), { round });
  const metrics = (rows) => Object.fromEntries(methods.map((method) => [method, score(rows, method)]));
  const current = score(pairs, 'current', false);
  const revised = score(pairs, 'revised', false);
  const passed = pairs.length > 0 && current.wape !== null && revised.wape !== null
    && revised.mae < current.mae && revised.wape < current.wape && revised.rmse <= current.rmse;
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
    topErrorUnits: [...errorsByUnit.values()].sort((a, b) => b.currentError - a.currentError).slice(0, 10), pairs,
  };
}
