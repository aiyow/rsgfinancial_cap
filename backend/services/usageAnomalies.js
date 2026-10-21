// Pure anomaly calculations shared by model selection and actual-usage review.
// This module deliberately has no dependency on forecasting or database code.
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
