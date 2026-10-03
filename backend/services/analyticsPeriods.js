// Shared visibility rule for training, evaluation, and forecast refresh.
export const analyticsPeriodCondition = (alias) => `(
  (${alias}.period_type = 'LIVE_BILLING' AND ${alias}.status IN ('FORWARDED', 'CLOSED'))
  OR (${alias}.period_type = 'HISTORICAL_ANALYTICS' AND ${alias}.readings_visible_at IS NOT NULL)
)`;
