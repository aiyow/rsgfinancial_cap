import assert from 'node:assert/strict'
import test from 'node:test'
import { buildUnitWaterAnalytics } from '../src/utils/unitWaterAnalytics.js'

const reading = (periodStart, consumption, waterCharge, extra = {}) => ({ periodStart, consumption, waterCharge,
  previousReading: 100, currentReading: 100 + Number(consumption), validationStatus: 'VALID', ...extra })
const forecast = (forecastForMonth, extra = {}) => ({ forecastForMonth, status: 'READY',
  predictedConsumption: '5', estimatedWaterCharge: '115', ...extra })

test('unit charts show monthly consumption rather than cumulative readings and preserve real zeros', () => {
  const result = buildUnitWaterAnalytics([reading('2026-09-01', '5', '115'), reading('2026-10-01', '0', '0')], [forecast('2026-11-01')])
  assert.deepEqual(result.rows.map(row => [row.actualConsumption, row.actualWaterBill]), [[5, 115], [0, 0], [null, null]])
  assert.equal(result.rows[2].estimatedConsumption, 5)
  assert.equal(result.rows[2].estimatedWaterBill, 115)
  assert.equal(result.rows[2].label, 'Nov 2026 estimate')
  assert.equal(result.latestReading.actualConsumption, 0)
})

test('missing and flagged months stay gaps instead of false zero-use readings', () => {
  const result = buildUnitWaterAnalytics([reading('2026-01-01', 3, 69), reading('2026-03-01', 99, 2277, { validationStatus: 'FLAGGED' }), reading('2026-04-01', '', null)], [])
  assert.deepEqual(result.rows.map(row => row.actualConsumption), [3, null, null, null])
  assert.deepEqual(result.rows.map(row => row.actualWaterBill), [69, null, null, null])
  assert.equal(result.flaggedCount, 1)
  assert.equal(result.latestReading.month, '2026-01')
})

test('only the latest future forecast is shown, without falling back to an older ready forecast', () => {
  const history = [reading('2026-10-01', 5, 115)]
  assert.equal(buildUnitWaterAnalytics(history, [forecast('2026-10-01')]).forecast, null)
  const result = buildUnitWaterAnalytics(history, [forecast('2026-10-01'), forecast('2026-11-01', { status: 'INSUFFICIENT_DATA', reason: 'Need more readings' })])
  assert.equal(result.forecast, null)
  assert.equal(result.latestForecast.reason, 'Need more readings')
  assert.equal(result.rows.length, 1)
  const revisions = [forecast('2026-11-01', { generatedAt: '2026-10-20T00:00:00Z', predictedConsumption: 20 }), forecast('2026-11-01', { generatedAt: '2026-10-21T00:00:00Z', predictedConsumption: 7 })]
  assert.equal(buildUnitWaterAnalytics(history, revisions).forecast.consumption, 7)
})

test('range filtering uses calendar months even when there are missing readings', () => {
  const history = [reading('2026-01-01', 1, 23), reading('2026-08-01', 8, 184), reading('2026-10-01', 10, 230)]
  const result = buildUnitWaterAnalytics(history, [forecast('2026-11-01')], '3')
  assert.deepEqual(result.rows.map(row => row.month), ['2026-08', '2026-09', '2026-10', '2026-11'])
  assert.equal(buildUnitWaterAnalytics(history, [], 'ALL').rows.length, 10)
  assert.equal(history.length, 3)
})

test('empty history and invalid numeric values never fabricate usage or charges', () => {
  assert.deepEqual(buildUnitWaterAnalytics().rows, [])
  const result = buildUnitWaterAnalytics([reading('2026-10-01', -5, 'bad')], [forecast('2026-11-01', { predictedConsumption: null, estimatedWaterCharge: -100 })])
  assert.equal(result.rows[0].actualConsumption, null)
  assert.equal(result.rows[0].actualWaterBill, null)
  assert.equal(result.rows.length, 1)
  assert.equal(result.latestReading, null)
  assert.equal(result.forecast.consumption, null)
  assert.equal(result.forecast.waterBill, null)
})

test('unsorted inputs are normalized without mutating source records', () => {
  const history = [reading('2026-10-01', 10, 230), reading('2026-09-01', 9, 207)]
  const forecasts = [forecast('2026-11-01'), forecast('2026-10-01')]
  const before = structuredClone({ history, forecasts })
  assert.deepEqual(buildUnitWaterAnalytics(history, forecasts).rows.map(row => row.month), ['2026-09', '2026-10', '2026-11'])
  assert.deepEqual({ history, forecasts }, before)
})
