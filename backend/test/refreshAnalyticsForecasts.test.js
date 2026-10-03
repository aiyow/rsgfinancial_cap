import assert from 'node:assert/strict';
import test from 'node:test';
import { refreshAnalyticsForecasts } from '../services/refreshAnalyticsForecasts.js';

function fixture(ids) {
  const calls = [];
  const client = { async query(sql) { calls.push(sql); return { rows: sql.startsWith('SELECT') ? ids.map((id) => ({ id })) : [] }; },
    release() { calls.push('RELEASE'); } };
  return { calls, client, pool: { async connect() { return client; } } };
}

for (const [label, ids] of [['history-only', [1, 2, 3]], ['mixed live and history', [1, 7, 8]]]) {
  test(`${label} refresh rebuilds chronologically, then updates recommendations`, async () => {
    const f = fixture(ids);
    const result = await refreshAnalyticsForecasts(f.pool, {
      generate: async (client, id) => { assert.equal(client, f.client); f.calls.push(`GENERATE ${id}`); },
      recommend: async () => f.calls.push('RECOMMEND'),
    });
    assert.equal(result.periodCount, ids.length);
    assert.match(f.calls[1], /ORDER BY p.period_start FOR UPDATE/);
    assert.match(f.calls[1], /HISTORICAL_ANALYTICS.*readings_visible_at/s);
    assert.match(f.calls[1], /FORWARDED.*CLOSED/);
    assert.deepEqual(f.calls.slice(2), [...ids.map((id) => `GENERATE ${id}`), 'RECOMMEND', 'COMMIT', 'RELEASE']);
  });
}

for (const failAt of ['generate', 'recommend']) {
  test(`${failAt} failure rolls back the entire refresh and releases the connection`, async () => {
    const f = fixture([1, 2]);
    await assert.rejects(refreshAnalyticsForecasts(f.pool, {
      generate: async () => { if (failAt === 'generate') throw Error('failure'); },
      recommend: async () => { if (failAt === 'recommend') throw Error('failure'); },
    }), /failure/);
    assert.ok(!f.calls.includes('COMMIT'));
    assert.deepEqual(f.calls.slice(-2), ['ROLLBACK', 'RELEASE']);
  });
}

test('empty installations return zero coverage without regenerating recommendations', async () => {
  const f = fixture([]);
  assert.deepEqual(await refreshAnalyticsForecasts(f.pool, {
    generate: async () => assert.fail('unexpected generation'), recommend: async () => assert.fail('unexpected recommendation'),
  }), { periodCount: 0 });
});
