import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

function valueOrDash(value, suffix = '') {
  return value === null || value === undefined ? '-' : `${Number(value).toFixed(2)}${suffix}`
}

function month(value) {
  return value ? new Date(value).toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'No evaluated month'
}

function monthLabel(value) {
  return new Date(value).toLocaleDateString('en-PH', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function number(value) {
  return value === null || value === undefined ? null : Number(value)
}

function money(value) {
  return `PHP ${Number(value || 0).toFixed(2)}`
}

function consumptionTooltip(value, name) {
  const label = name === 'forecastConsumption' ? 'Projected forecast' : 'Historical actual'
  return [`${Number(value).toFixed(3)} m3`, label]
}

function billTooltip(value, name) {
  const label = name === 'forecastWaterBill' ? 'Projected forecast' : 'Historical actual'
  return [money(value), label]
}

function connectForecastLine(rows, actualKey, projectedKey, forecastKey) {
  const result = rows.map((row) => ({ ...row, [forecastKey]: row[projectedKey] }))
  const firstProjectedIndex = result.findIndex((row) => row[projectedKey] !== null)
  if (firstProjectedIndex === -1) return result

  let anchorIndex = -1
  for (let index = firstProjectedIndex; index >= 0; index -= 1) {
    if (result[index][actualKey] !== null) {
      anchorIndex = index
      break
    }
  }
  if (anchorIndex !== -1) result[anchorIndex][forecastKey] = result[anchorIndex][actualKey]
  return result
}

export default function AnalyticsPage() {
  const { token, user } = useAuth()
  const [data, setData] = useState(null)
  const [recommendations, setRecommendations] = useState([])
  const [recommendationBusyId, setRecommendationBusyId] = useState(null)
  const [showAllRecommendations, setShowAllRecommendations] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([
      apiRequest('/api/analytics/overview', { token }),
      apiRequest('/api/prescriptive-recommendations', { token }),
    ])
      .then(([analyticsData, recommendationData]) => {
        if (!active) return
        setData(analyticsData)
        setRecommendations(recommendationData.recommendations || [])
      })
      .catch((requestError) => setError(requestError.message))

    return () => { active = false }
  }, [token])

  async function deleteRecommendation(recommendation) {
    if (!window.confirm(`Permanently delete the recommendation for Unit ${recommendation.unitNumber}?`)) return
    setRecommendationBusyId(recommendation.id)
    try {
      await apiRequest(`/api/prescriptive-recommendations/${recommendation.id}`, { method: 'DELETE', token })
      setRecommendations((current) => current.filter((item) => item.id !== recommendation.id))
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setRecommendationBusyId(null)
    }
  }

  const metrics = data?.metrics || {}
  const hasAnalyticsData = Boolean(data && ((data.latestForecast?.total || 0) > 0 || data.diagnostics.length > 0 || data.flaggedReadings.length > 0))
  const rawChartData = (data?.chartSeries || []).map((row) => ({
    ...row,
    label: monthLabel(row.month),
    actualConsumption: number(row.actualConsumption),
    projectedConsumption: number(row.projectedConsumption),
    actualWaterBill: number(row.actualWaterBill),
    projectedWaterBill: number(row.projectedWaterBill),
  }))
  const chartData = connectForecastLine(
    connectForecastLine(rawChartData, 'actualConsumption', 'projectedConsumption', 'forecastConsumption'),
    'actualWaterBill',
    'projectedWaterBill',
    'forecastWaterBill',
  )
  const recommendationSummary = {
    open: recommendations.filter((recommendation) => recommendation.status === 'OPEN').length,
    viewed: recommendations.filter((recommendation) => recommendation.status === 'VIEWED').length,
    high: recommendations.filter((recommendation) => recommendation.priority === 'HIGH').length,
  }
  const visibleRecommendations = showAllRecommendations ? recommendations : recommendations.slice(0, 5)

  return (
    <DashboardLayout title="Predictive water analytics" description="Review model accuracy, forecast coverage, and meter readings excluded from regression.">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {data && !hasAnalyticsData ? (
        <Panel title="No analytics data yet" description="No analytics data yet. Import historical readings first.">
          {user.role === 'COLLECTOR'
            ? <Link to="/collector/history-import" className="inline-flex rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white">Open analytics import</Link>
            : <EmptyRow message="Collector needs to import historical readings before analytics and predictions appear." />}
        </Panel>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Metric label="Holdout month" value={month(data?.evaluationMonth)} />
            <Metric label="WAPE accuracy" value={valueOrDash(metrics.accuracy, '%')} />
            <Metric label="MAE" value={valueOrDash(metrics.mae, ' m3')} />
            <Metric label="RMSE" value={valueOrDash(metrics.rmse, ' m3')} />
            <Metric label="Evaluated / excluded" value={`${metrics.evaluatedCount || 0} / ${metrics.excludedCount || 0}`} />
          </div>

          <Panel title="Latest forecast coverage" description="A unit needs five consecutive valid monthly readings after any meter reset or continuity break.">
            {!data ? <EmptyRow message="Loading forecast coverage..." /> : (
              <div className="grid gap-4 sm:grid-cols-3">
                <Metric label="Forecast month" value={month(data.latestForecast.forecastForMonth)} compact />
                <Metric label="Ready" value={data.latestForecast.ready || 0} compact />
                <Metric label="Excluded / insufficient" value={data.latestForecast.excluded || 0} compact />
              </div>
            )}
          </Panel>

          <div className="grid gap-6 xl:grid-cols-2">
            <ChartCard title="Historical vs Projected Water Consumption" description="Monthly total consumption in cubic meters.">
              {chartData.length ? (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" angle={-25} textAnchor="end" height={70} tick={{ fontSize: 12 }} />
                    <YAxis unit=" m3" tick={{ fontSize: 12 }} />
                    <Tooltip formatter={consumptionTooltip} />
                    <Legend />
                    <Line type="monotone" dataKey="actualConsumption" name="Historical actual" stroke="#2563eb" strokeWidth={3} dot={{ r: 4, fill: '#fff', strokeWidth: 3 }} activeDot={{ r: 6 }} />
                    <Line type="monotone" dataKey="forecastConsumption" name="Projected forecast" stroke="#7c3aed" strokeWidth={3} strokeDasharray="7 5" dot={{ r: 4, fill: '#fff', strokeWidth: 3 }} activeDot={{ r: 6 }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              ) : <EmptyRow message="No chart data is available yet." />}
            </ChartCard>

            <ChartCard title="Historical vs Projected Water Bill" description="Monthly total water charges from actual readings and forecasts.">
              {chartData.length ? (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" angle={-25} textAnchor="end" height={70} tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip formatter={billTooltip} />
                    <Legend />
                    <Line type="monotone" dataKey="actualWaterBill" name="Historical actual" stroke="#059669" strokeWidth={3} dot={{ r: 4, fill: '#fff', strokeWidth: 3 }} activeDot={{ r: 6 }} />
                    <Line type="monotone" dataKey="forecastWaterBill" name="Projected forecast" stroke="#ea580c" strokeWidth={3} strokeDasharray="7 5" dot={{ r: 4, fill: '#fff', strokeWidth: 3 }} activeDot={{ r: 6 }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              ) : <EmptyRow message="No chart data is available yet." />}
            </ChartCard>
          </div>

          <Panel title="Recommended actions" description="These suggestions are based on the latest live billing period and the same readings used by the forecast.">
            <div className="mb-5 grid gap-3 sm:grid-cols-3">
              <Metric label="Open" value={recommendationSummary.open} compact />
              <Metric label="Viewed" value={recommendationSummary.viewed} compact />
              <Metric label="High priority" value={recommendationSummary.high} compact />
            </div>
            {recommendations.length ? (
              <div className="space-y-3">
                {visibleRecommendations.map((recommendation) => {
                  const busy = recommendationBusyId === recommendation.id
                  return (
                    <article key={recommendation.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${recommendation.priority === 'HIGH' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'}`}>{recommendation.priority}</span>
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{recommendation.status}</span>
                            {recommendation.residentVisibleAt && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">Visible to Resident</span>}
                          </div>
                          <p className="mt-3 font-black text-slate-950">Unit {recommendation.unitNumber}: {recommendation.message}</p>
                          <p className="mt-1 text-sm text-slate-500">{recommendationEvidence(recommendation)}</p>
                        </div>
                        <div className="flex flex-wrap gap-2 lg:justify-end">
                          <ActionButton disabled={busy} onClick={() => deleteRecommendation(recommendation)}>{busy ? 'Deleting...' : 'Delete'}</ActionButton>
                        </div>
                      </div>
                    </article>
                  )
                })}
                {recommendations.length > 5 && (
                  <button
                    type="button"
                    onClick={() => setShowAllRecommendations((value) => !value)}
                    className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
                  >
                    {showAllRecommendations ? 'Show fewer recommendations' : `Show all ${recommendations.length} recommendations`}
                  </button>
                )}
              </div>
            ) : <EmptyRow message="No action is recommended for the latest live billing period." />}
          </Panel>

          <Panel title="Predicted versus actual" description={`Visible to ${user.role === 'ADMIN' ? 'Admin' : 'Collector'} staff only. WAPE avoids division problems for units with zero consumption.`}>
            {data?.diagnostics.length ? (
              <div className="overflow-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-400"><tr><th className="p-3">Unit</th><th>Forecast month</th><th>Predicted</th><th>Actual</th><th>Absolute error</th><th>Status</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.diagnostics.map((row) => (
                      <tr key={`${row.unitId}-${row.forecastForMonth}`} className={row.status !== 'READY' || row.actualValidationStatus !== 'VALID' ? 'bg-amber-50' : ''}>
                        <td className="p-3 font-bold">Unit {row.unitNumber}</td>
                        <td>{String(row.forecastForMonth).slice(0, 10)}</td>
                        <td>{row.predictedConsumption === null ? '-' : `${Number(row.predictedConsumption).toFixed(3)} m3`}</td>
                        <td>{row.actualConsumption === null ? '-' : `${Number(row.actualConsumption).toFixed(3)} m3`}</td>
                        <td>{row.absoluteError === null ? '-' : `${Number(row.absoluteError).toFixed(3)} m3`}</td>
                        <td><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${row.status === 'READY' && row.actualValidationStatus === 'VALID' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>{row.status === 'READY' ? row.actualValidationStatus || 'NO ACTUAL' : row.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyRow message="No forecast has a matching actual month yet. Import five months, then import the holdout month." />}
          </Panel>

          <Panel title="Flagged meter readings" description="These readings remain visible for correction but do not train the model.">
            {data?.flaggedReadings.length ? (
              <div className="space-y-3">
                {data.flaggedReadings.map((reading) => (
                  <article key={reading.id} className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
                    <p className="font-black text-slate-900">Unit {reading.unitNumber} - {month(reading.periodStart)}</p>
                    <p className="mt-1 text-slate-700">{reading.previousReading} to {reading.currentReading}</p>
                    <p className="mt-2 text-amber-800">{reading.reason}</p>
                  </article>
                ))}
              </div>
            ) : <EmptyRow message="No flagged readings are currently recorded." />}
          </Panel>
        </>
      )}
    </DashboardLayout>
  )
}

function Metric({ label, value, compact = false }) {
  return <div className={`rounded-2xl border border-slate-200 bg-white ${compact ? 'p-4 shadow-none' : 'p-5 shadow-sm'}`}><p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p><p className={`${compact ? 'mt-2 text-xl' : 'mt-3 text-2xl'} font-black text-slate-950`}>{value}</p></div>
}

function ChartCard({ title, description, children }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="font-black text-slate-950">{title}</h3>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
      <div className="mt-5">{children}</div>
    </div>
  )
}

function recommendationEvidence(recommendation) {
  const evidence = recommendation.evidence || {}
  if (recommendation.recommendationType === 'CHECK_HIGH_USAGE') {
    return `${Number(evidence.predictedConsumption || 0).toFixed(3)} m3 projected versus ${Number(evidence.recentAverage || 0).toFixed(3)} m3 recent average (+${Number(evidence.increasePercent || 0).toFixed(2)}%).`
  }
  if (recommendation.recommendationType === 'COLLECT_MORE_HISTORY') {
    return `${evidence.missingMonths || 0} more valid monthly reading${Number(evidence.missingMonths) === 1 ? '' : 's'} needed.`
  }
  return evidence.reason || 'The latest meter reading is not valid for forecasting.'
}

function ActionButton({ children, ...props }) {
  return <button {...props} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50">{children}</button>
}
