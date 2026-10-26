import { writeAuditLog } from './auditLog.js';
import { analyticsPeriodCondition } from './analyticsPeriods.js';
import { regenerateForecasts } from './predictiveAnalytics.js';
import { regeneratePrescriptiveRecommendations } from './prescriptiveAnalytics.js';

export async function refreshAnalyticsForecasts(pool, {
  generate = regenerateForecasts, recommend = regeneratePrescriptiveRecommendations, actorUserId = null,
} = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Chronological rebuild and recommendations share a single transaction.
    const periods = await client.query(`SELECT p.id FROM billing_periods p
      WHERE ${analyticsPeriodCondition('p')} ORDER BY p.period_start FOR UPDATE`);
    for (const period of periods.rows) await generate(client, period.id);
    if (periods.rows.length) {
      await recommend(client);
      await writeAuditLog({ client, actorUserId, entityName: 'ANALYTICS', action: 'REFRESH_FORECASTS', newValues: { periodCount: periods.rows.length, forecastsRefreshed: true, recommendationsRefreshed: true }, context: { target: { label: 'Water forecasts and recommendations' }, affectedRecords: periods.rows.map(row => ({ entityName: 'BILLING_PERIOD', entityId: row.id })) } });
    }
    await client.query('COMMIT');
    return { periodCount: periods.rows.length };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
