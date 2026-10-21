// Display names only: keep stored model identifiers and forecast calculations unchanged.
export function forecastModelLabel(modelName, status) {
  if (status && status !== 'READY') return 'No forecast'
  if (modelName === 'STABLE_RECENT_ENSEMBLE') return 'Stable Recent Months'
  return String(modelName || 'LINEAR_REGRESSION').replaceAll('_', ' ')
}
