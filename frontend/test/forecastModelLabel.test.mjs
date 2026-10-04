import assert from 'node:assert/strict'
import test from 'node:test'
import { forecastModelLabel } from '../src/utils/forecastModelLabel.js'

test('stable recent ensemble uses a friendly display label without altering its identifier', () => {
  const modelName = 'STABLE_RECENT_ENSEMBLE'
  assert.equal(forecastModelLabel(modelName), 'Stable Recent Months')
  assert.equal(modelName, 'STABLE_RECENT_ENSEMBLE')
})

test('other models and missing model names retain their existing display', () => {
  assert.equal(forecastModelLabel('LINEAR_REGRESSION'), 'LINEAR REGRESSION')
  assert.equal(forecastModelLabel(null), 'LINEAR REGRESSION')
  assert.equal(forecastModelLabel('OTHER_MODEL'), 'OTHER MODEL')
})
