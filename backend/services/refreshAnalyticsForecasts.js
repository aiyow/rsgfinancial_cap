import { analyticsPeriodCondition } from './analyticsPeriods.js';
import { regenerateForecasts } from './predictiveAnalytics.js';
import { regeneratePrescriptiveRecommendations } from './prescriptiveAnalytics.js';

export async function refreshAnalyticsForecasts(pool, {
  generate = regenerateForecasts, recommend = regeneratePrescriptiveRecommendations,
} = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Chronological rebuild and recommendations share a single transaction.
    const periods = await client.query(`SELECT p.id FROM billing_periods p
      WHERE ${analyticsPeriodCondition('p')} ORDER BY p.period_start FOR UPDATE`);
    for (const period of periods.rows) await generate(client, period.id);
    if (periods.rows.length) await recommend(client);
    await client.query('COMMIT');
    return { periodCount: periods.rows.length };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
