const CONTINUITY_TOLERANCE = 0.001

function numeric(value) {
  const result = Number(value)
  return Number.isFinite(result) ? result : null
}

export function validateMeterReading(previousReading, currentReading, priorReading) {
  const previous = numeric(previousReading)
  const current = numeric(currentReading)
  const priorCurrent = numeric(priorReading?.currentReading ?? priorReading)
  const notes = []
  let flagged = false

  if (previous === null || current === null) return { status: 'FLAGGED', notes: ['Meter readings must be numbers.'] }
  if (current < previous) {
    notes.push('Present reading is lower than the previous reading.')
    flagged = true
  }

  const continuityBreak = priorCurrent !== null && Math.abs(priorCurrent - previous) > CONTINUITY_TOLERANCE
  const isMeterReset = continuityBreak
    && previous <= CONTINUITY_TOLERANCE
    && current >= previous
    && priorCurrent > current + CONTINUITY_TOLERANCE

  if (continuityBreak && !isMeterReset) {
    notes.push(`Previous reading does not match the last recorded present reading (${priorCurrent}).`)
    flagged = true
  }
  if (isMeterReset) notes.push('Meter reset recorded; consumption is measured from the replacement meter.')

  return { status: flagged ? 'FLAGGED' : 'VALID', notes }
}
