import { calculateAccuracy, monthIndex, selectConsecutiveReadings } from './predictiveAnalytics.js';

import { classifyUsageChange, usageReviewRule } from './usageAnomalies.js';
export { usageReviewRule } from './usageAnomalies.js';

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
