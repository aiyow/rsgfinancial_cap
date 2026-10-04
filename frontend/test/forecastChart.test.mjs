import assert from 'node:assert/strict'
import test from 'node:test'
import { chartNumber, connectForecastLine } from '../src/utils/forecastChart.js'

const connect = (rows) => connectForecastLine(rows, 'actual', 'projected', 'forecast')

test('historical forecasts are hidden; only the latest actual anchors the future line', () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({
    month: index + 1,
    actual: index < 9 ? 15000 + index * 100 : null,
    projected: index >= 5 ? 14000 + index * 100 : null,
  }))
  const before = structuredClone(rows)
  const result = connect(rows)
  assert.deepEqual(result.map((row) => row.forecast), [null, null, null, null, null, null, null, null, 15800, 14900])
  assert.deepEqual(result.slice(-2).map((row) => row.forecast), [15800, 14900])
  assert.deepEqual(rows, before, 'source data, including retrospective projections, must not be mutated')
})

test('a newly observed month moves the anchor forward', () => {
  const result = connect([
    { actual: 100, projected: 90 },
    { actual: 110, projected: 95 },
    { actual: null, projected: 105 },
  ])
  assert.deepEqual(result.map((row) => row.forecast), [null, 110, 105])
})

test('no future forecast means no dashed historical line or anchor', () => {
  assert.deepEqual(connect([{ actual: 100, projected: 90 }, { actual: 110, projected: null }]).map((row) => row.forecast), [null, null])
  assert.deepEqual(connect([{ actual: 100 }, { projected: '' }]).map((row) => row.forecast), [null, null])
  assert.deepEqual(connect([]), [])
})

test('forecast-only series and missing future months preserve nulls', () => {
  assert.deepEqual(connect([{ projected: 10 }, { projected: null }, { projected: 12 }]).map((row) => row.forecast), [10, null, 12])
  assert.deepEqual(connect([{ actual: 10 }, {}, { projected: 12 }]).map((row) => row.forecast), [10, null, 12])
})

test('real zeros and numeric strings are valid; missing or invalid values are not zero', () => {
  assert.equal(chartNumber(0), 0)
  assert.equal(chartNumber('0'), 0)
  assert.equal(chartNumber('123.45'), 123.45)
  for (const value of [null, undefined, '', '  ', NaN, Infinity, -Infinity, 'bad', true, []]) assert.equal(chartNumber(value), null)
  assert.deepEqual(connect([{ actual: '0', projected: 9 }, { actual: '', projected: '0' }]).map((row) => row.forecast), [0, 0])
})

test('independent consumption and bill connectors retain each others output', () => {
  const rows = [
    { actual: 0, projected: 5, bill: 0, projectedBill: 115 },
    { actual: null, projected: 3, bill: null, projectedBill: 69 },
  ]
  const result = connectForecastLine(connect(rows), 'bill', 'projectedBill', 'forecastBill')
  assert.deepEqual(result.map((row) => [row.forecast, row.forecastBill]), [[0, 0], [3, 69]])
})
