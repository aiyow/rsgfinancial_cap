export function chartNumber(value) {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

// Rows are chronological. Retrospective forecasts remain available in the data,
// but the plotted dashed line starts at the latest actual and continues forward.
export function connectForecastLine(rows, actualKey, projectedKey, forecastKey) {
  const normalized = rows.map((row) => ({
    ...row,
    [actualKey]: chartNumber(row[actualKey]),
    [projectedKey]: chartNumber(row[projectedKey]),
  }))
  const latestActualIndex = normalized.reduce(
    (latestIndex, row, index) => (row[actualKey] !== null ? index : latestIndex),
    -1,
  )
  const hasFutureForecast = normalized.some((row, index) => index > latestActualIndex && row[projectedKey] !== null)

  return normalized.map((row, index) => {
    let forecast = null
    if (latestActualIndex === -1) forecast = row[projectedKey]
    else if (index === latestActualIndex && hasFutureForecast) forecast = row[actualKey]
    else if (index > latestActualIndex) forecast = row[projectedKey]
    return { ...row, [forecastKey]: forecast }
  })
}
