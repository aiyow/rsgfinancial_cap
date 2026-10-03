import { calculateAccuracy, monthIndex, selectConsecutiveReadings } from './predictiveAnalytics.js';

// A fixed usage-review rule, independent of forecast error or the chosen model.
// It describes unusual actuals after they arrive; it never changes training,
// stored validation statuses, or the primary evaluation score.
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

export function detectUsageChange(history, sourceMonth, actualConsumption) {
  if (!validNumber(actualConsumption)) return null;
  const training = (history || []).filter((row) => monthIndex(row.periodStart) <= monthIndex(sourceMonth));
  const selected = selectConsecutiveReadings(training, usageReviewRule.historyMonths);
  if (selected.length < usageReviewRule.historyMonths
    || monthIndex(selected.at(-1).periodStart) !== monthIndex(sourceMonth)) return null;
  const values = selected.map((row) => Number(row.consumption));
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
    priorMonthCount: selected.length,
  };
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
