import assert from 'node:assert/strict'
import test from 'node:test'
import { validateMeterReading } from '../services/meterReadingValidation.js'

test('recognizes a zero-start replacement meter as a valid reset', () => {
  const result = validateMeterReading(0, 27.5, { currentReading: 18993.937 })
  assert.equal(result.status, 'VALID')
  assert.match(result.notes.join(' '), /Meter reset recorded/)
})

test('flags an unexplained break in meter-reading continuity', () => {
  const result = validateMeterReading(100, 125, { currentReading: 500 })
  assert.equal(result.status, 'FLAGGED')
  assert.match(result.notes.join(' '), /does not match/)
})

test('flags a reading that decreases within the same meter', () => {
  const result = validateMeterReading(125, 100, { currentReading: 125 })
  assert.equal(result.status, 'FLAGGED')
  assert.match(result.notes.join(' '), /lower than the previous/)
})
