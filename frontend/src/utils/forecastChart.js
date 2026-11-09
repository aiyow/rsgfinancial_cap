export function chartNumber(value) {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

export function paddedDomain(values) {
  const numericValues = values.filter(Number.isFinite)
  if (!numericValues.length) return ['auto', 'auto']
  const min = Math.min(...numericValues)
  const max = Math.max(...numericValues)
  const padding = Math.max(max - min, 1) * 0.2
  return [Math.max(0, Math.floor((min - padding) * 1000) / 1000), Math.ceil((max + padding) * 1000) / 1000]
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
