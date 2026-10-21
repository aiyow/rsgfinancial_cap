import { chartNumber } from './forecastChart.js'

function monthKey(value) {
  const key = String(value || '').slice(0, 7)
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(key) ? key : null
}

function monthIndex(key) {
  const [year, month] = key.split('-').map(Number)
  return year * 12 + month - 1
}

function nonnegative(value) {
  const number = chartNumber(value)
  return number !== null && number >= 0 ? number : null
}

function label(key) {
  return new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-PH', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export function buildUnitWaterAnalytics(history = [], forecasts = [], range = '12') {
  const byMonth = new Map()
  const orderedHistory = [...history].sort((a, b) => String(a.periodStart).localeCompare(String(b.periodStart))
    || Number(a.billingPeriodId || 0) - Number(b.billingPeriodId || 0))
  for (const reading of orderedHistory) {
    const key = monthKey(reading.periodStart)
    if (!key) continue
    const valid = reading.validationStatus === 'VALID'
    byMonth.set(key, {
      month: key, label: label(key),
      actualConsumption: valid ? nonnegative(reading.consumption) : null,
      actualWaterBill: valid ? nonnegative(reading.waterCharge) : null,
      estimatedConsumption: null, estimatedWaterBill: null,
    })
  }
  const actualMonths = [...byMonth.keys()]
  const latestMonth = actualMonths.at(-1)
  const latestReading = [...byMonth.values()].filter(row => row.actualConsumption !== null).at(-1) || null
  const latestForecast = [...forecasts].filter(row => monthKey(row.forecastForMonth)).sort((a, b) =>
    String(a.forecastForMonth).localeCompare(String(b.forecastForMonth))
      || String(a.generatedAt || '').localeCompare(String(b.generatedAt || ''))).at(-1) || null
  const forecastMonth = monthKey(latestForecast?.forecastForMonth)
  const forecast = latestForecast?.status === 'READY' && (!latestMonth || forecastMonth > latestMonth)
    ? { ...latestForecast, label: label(forecastMonth), consumption: nonnegative(latestForecast.predictedConsumption), waterBill: nonnegative(latestForecast.estimatedWaterCharge) }
    : null
  if (forecast && (forecast.consumption !== null || forecast.waterBill !== null)) {
    byMonth.set(forecastMonth, {
      month: forecastMonth, label: `${label(forecastMonth)} estimate`,
      actualConsumption: null, actualWaterBill: null,
      estimatedConsumption: forecast.consumption, estimatedWaterBill: forecast.waterBill,
    })
  }
  const months = [...byMonth.keys()].sort()
  const rows = []
  if (months.length) {
    let start = monthIndex(months[0])
    const end = monthIndex(months.at(-1))
    if (range !== 'ALL') start = Math.max(start, monthIndex(latestMonth || months.at(-1)) - Number(range) + 1)
    for (let index = start; index <= end; index++) {
      const key = `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`
      rows.push(byMonth.get(key) || { month: key, label: label(key), actualConsumption: null, actualWaterBill: null, estimatedConsumption: null, estimatedWaterBill: null })
    }
  }
  return { rows, latestReading, forecast, latestForecast,
    flaggedCount: history.filter(row => row.validationStatus === 'FLAGGED').length }
}
