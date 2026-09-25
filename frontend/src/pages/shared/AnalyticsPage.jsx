import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, CalendarDays, ChartNoAxesCombined, ChevronDown, Gauge, ListChecks, RefreshCw } from 'lucide-react'
import {
  Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
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

const forecastRanges = [
  { value: 'twoMonths', label: '2 months', months: 2 },
  { value: 'fourMonths', label: '4 months', months: 4 },
  { value: 'sixMonths', label: '6 months', months: 6 },
  { value: 'twelveMonths', label: '12 months', months: 12 },
]

function filterChartRows(rows, range) {
  const months = forecastRanges.find((option) => option.value === range)?.months || 12
  return rows.slice(-months)
}

export default function AnalyticsPage() {
  const { token, user } = useAuth()
  const [data, setData] = useState(null)
  const [recommendations, setRecommendations] = useState([])
  const [recommendationBusyId, setRecommendationBusyId] = useState(null)
  const [showAllRecommendations, setShowAllRecommendations] = useState(false)
  const [recommendationSort, setRecommendationSort] = useState('PRIORITY')
  const [recommendationPriority, setRecommendationPriority] = useState('ALL')
  const [recommendationSearch, setRecommendationSearch] = useState('')
  const [expandedRecommendationId, setExpandedRecommendationId] = useState(null)
  const [consumptionRange, setConsumptionRange] = useState('sixMonths')
  const [waterBillRange, setWaterBillRange] = useState('sixMonths')
  const [showForecastQuality, setShowForecastQuality] = useState(false)
  const [refreshingForecasts, setRefreshingForecasts] = useState(false)
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

  async function refreshForecasts() {
    if (!window.confirm('Recalculate all saved forecasts using the current model? This may take a moment.')) return
    setRefreshingForecasts(true)
    setError('')
    try {
      await apiRequest('/api/analytics/refresh-forecasts', { method: 'POST', token })
      const analyticsData = await apiRequest('/api/analytics/overview', { token })
      setData(analyticsData)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setRefreshingForecasts(false)
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
  const consumptionChartData = filterChartRows(chartData, consumptionRange)
  const waterBillChartData = filterChartRows(chartData, waterBillRange)
  const recommendationSummary = {
    active: recommendations.length,
    high: recommendations.filter((recommendation) => recommendation.priority === 'HIGH').length,
    units: new Set(recommendations.map((recommendation) => recommendation.unitId)).size,
  }
  const sortedRecommendations = useMemo(() => {
    const priority = { HIGH: 0, MEDIUM: 1, LOW: 2 }
    const query = recommendationSearch.trim().toLowerCase()
    return recommendations.filter((recommendation) => {
      const matchesPriority = recommendationPriority === 'ALL' || recommendation.priority === recommendationPriority
      const searchable = `Unit ${recommendation.unitNumber} ${recommendation.message} ${recommendation.recommendationType}`.toLowerCase()
      return matchesPriority && (!query || searchable.includes(query))
    }).sort((left, right) => {
      if (recommendationSort === 'UNIT') return String(left.unitNumber).localeCompare(String(right.unitNumber), undefined, { numeric: true })
      return (priority[left.priority] ?? 9) - (priority[right.priority] ?? 9) || String(left.unitNumber).localeCompare(String(right.unitNumber), undefined, { numeric: true })
    })
  }, [recommendationPriority, recommendationSearch, recommendationSort, recommendations])
  const visibleRecommendations = showAllRecommendations ? sortedRecommendations : sortedRecommendations.slice(0, 10)
  const analyticsAccents = ['blue', 'green', 'red', 'blue', 'green']

  return (
    <DashboardLayout title="Predictive & Prescriptive Water Analytics" description="Review forecasts and the recommended actions generated from water use, occupancy, readings, and billing status.">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {data && !hasAnalyticsData ? (
        <Panel title="No analytics data yet" description="No analytics data yet. Import historical readings first.">
          {user.role === 'COLLECTOR'
            ? <Link to="/collector/history-import" className="inline-flex rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white">Open analytics import</Link>
            : <EmptyRow message="A Billing Associate needs to import historical readings before analytics and predictions appear." />}
        </Panel>
      ) : (
        <>
          <div className="mb-4 flex justify-end"><button type="button" onClick={refreshForecasts} disabled={refreshingForecasts} className="inline-flex items-center gap-2 rounded-lg border border-emerald-600 bg-white px-4 py-2.5 text-sm font-bold text-emerald-700 transition hover:bg-emerald-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"><RefreshCw size={16} className={refreshingForecasts ? 'animate-spin' : ''} />{refreshingForecasts ? 'Refreshing forecasts...' : 'Refresh forecasts'}</button></div>
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
            <ChartCard title="Historical vs Projected Water Consumption" description="Monthly total consumption in cubic meters." filter={<ForecastRangeFilter value={consumptionRange} onChange={setConsumptionRange} />}>
              {consumptionChartData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={consumptionChartData} margin={{ top: 10, right: 16, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" angle={-25} textAnchor="end" height={70} tick={{ fontSize: 12 }} />
                    <YAxis unit=" m3" tick={{ fontSize: 12 }} />
                    <Tooltip formatter={consumptionTooltip} />
                    <Legend />
                    <Area type="monotone" dataKey="actualConsumption" name="Historical actual" stroke="#2563eb" fill="#93c5fd" fillOpacity={0.28} strokeWidth={3} dot={{ r: 3, fill: '#fff', strokeWidth: 2 }} activeDot={{ r: 6 }} animationBegin={0} animationDuration={1200} animationEasing="ease-out" />
                    <Area type="monotone" dataKey="forecastConsumption" name="Projected forecast" stroke="#7c3aed" fill="#c4b5fd" fillOpacity={0.2} strokeWidth={3} strokeDasharray="7 5" dot={{ r: 3, fill: '#fff', strokeWidth: 2 }} activeDot={{ r: 6 }} connectNulls animationBegin={140} animationDuration={1200} animationEasing="ease-out" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <EmptyRow message="No chart data is available yet." />}
            </ChartCard>

            <ChartCard title="Historical vs Projected Water Bill" description="Monthly total water charges from actual readings and forecasts." filter={<ForecastRangeFilter value={waterBillRange} onChange={setWaterBillRange} />}>
              {waterBillChartData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={waterBillChartData} margin={{ top: 10, right: 16, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" angle={-25} textAnchor="end" height={70} tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip formatter={billTooltip} />
                    <Legend />
                    <Area type="monotone" dataKey="actualWaterBill" name="Historical actual" stroke="#059669" fill="#86efac" fillOpacity={0.24} strokeWidth={3} dot={{ r: 3, fill: '#fff', strokeWidth: 2 }} activeDot={{ r: 6 }} animationBegin={0} animationDuration={1200} animationEasing="ease-out" />
                    <Area type="monotone" dataKey="forecastWaterBill" name="Projected forecast" stroke="#ea580c" fill="#fdba74" fillOpacity={0.18} strokeWidth={3} strokeDasharray="7 5" dot={{ r: 3, fill: '#fff', strokeWidth: 2 }} activeDot={{ r: 6 }} connectNulls animationBegin={140} animationDuration={1200} animationEasing="ease-out" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <EmptyRow message="No chart data is available yet." />}
            </ChartCard>
          </div>

          <Panel title="Prescriptive Recommendations" description="A prioritized action queue for the latest billing batch forwarded to Admin.">
            <div className="mb-5 grid gap-3 sm:grid-cols-3">
              <Metric label="Action needed" value={recommendationSummary.active} compact />
              <Metric label="High priority" value={recommendationSummary.high} compact />
              <Metric label="Units affected" value={recommendationSummary.units} compact />
            </div>
            {recommendations.length ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-black text-slate-900">Action queue</p><p className="mt-0.5 text-sm text-slate-500">Find the most urgent recommendation, then open it for the supporting evidence.</p></div><p className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600 ring-1 ring-slate-200">{sortedRecommendations.length} matching</p></div><div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_170px_180px]"><label className="text-xs font-bold text-slate-600">Search<input type="search" value={recommendationSearch} onChange={(event) => { setRecommendationSearch(event.target.value); setShowAllRecommendations(false) }} placeholder="Unit, action, or condition..." className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" /></label><label className="text-xs font-bold text-slate-600">Priority<select value={recommendationPriority} onChange={(event) => { setRecommendationPriority(event.target.value); setShowAllRecommendations(false) }} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"><option value="ALL">All priorities</option><option value="HIGH">High priority</option><option value="MEDIUM">Medium priority</option></select></label><label className="text-xs font-bold text-slate-600">Sort by<select value={recommendationSort} onChange={(event) => setRecommendationSort(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"><option value="PRIORITY">Priority: high first</option><option value="UNIT">Unit number</option></select></label></div></div>
                <div className={showAllRecommendations ? 'max-h-[42rem] space-y-3 overflow-y-auto overscroll-contain pr-2' : 'space-y-3'} aria-label="Prescriptive recommendations">
                  {visibleRecommendations.map((recommendation) => {
                    const busy = recommendationBusyId === recommendation.id
                    const expanded = expandedRecommendationId === recommendation.id
                    return (
                      <article key={recommendation.id} className={`rounded-xl border p-4 ${recommendation.priority === 'HIGH' ? 'border-rose-200 bg-rose-50/30' : 'border-slate-200 bg-white'}`}>
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <button type="button" onClick={() => setExpandedRecommendationId((current) => current === recommendation.id ? null : recommendation.id)} aria-expanded={expanded} className="min-w-0 flex-1 text-left">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${recommendation.priority === 'HIGH' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'}`}>{recommendation.priority}</span>
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{recommendationTypeLabel(recommendation.recommendationType)}</span>
                              {recommendation.residentVisibleAt && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">Visible to Resident</span>}
                            </div>
                            <div className="mt-3 flex items-center justify-between gap-4"><p className="font-black text-slate-900">Unit {recommendation.unitNumber}</p><span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700">{expanded ? 'Hide details' : 'View details'} <ChevronDown size={15} className={`transition ${expanded ? 'rotate-180' : ''}`} /></span></div>
                            <p className="mt-1 truncate text-sm text-slate-600">{recommendation.message}</p>
                          </button>
                          <div className="flex flex-wrap gap-2 lg:justify-end">
                            <ActionButton disabled={busy} onClick={() => deleteRecommendation(recommendation)}>{busy ? 'Deleting...' : 'Delete'}</ActionButton>
                          </div>
                        </div>
                        {expanded && <div className="mt-4 border-t border-slate-100 pt-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Condition detected</p><p className="mt-1 font-bold text-slate-900">{recommendation.evidence?.condition || recommendationEvidence(recommendation)}</p><p className="mt-3 text-xs font-bold uppercase tracking-wide text-slate-400">Recommended action</p><p className="mt-1 font-black text-slate-950">{recommendation.message}</p><p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{recommendationEvidence(recommendation)}</p></div>}
                      </article>
                    )
                  })}
                  {sortedRecommendations.length === 0 && <EmptyRow message="No recommendations match the selected search or priority." />}
                </div>
                {sortedRecommendations.length > 10 && (
                  <button
                    type="button"
                    onClick={() => setShowAllRecommendations((value) => !value)}
                    className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
                  >
                    {showAllRecommendations ? 'Show fewer recommendations' : `Show all ${sortedRecommendations.length} matching recommendations`}
                  </button>
                )}
              </div>
            ) : <EmptyRow message="No action is recommended for the latest live billing period." />}
          </Panel>

          <Panel title="Predicted versus actual" description={`Visible to ${user.role === 'ADMIN' ? 'Admin' : 'Billing Associate'} staff only. WAPE avoids division problems for units with zero consumption.`}>
            {data?.diagnostics.length ? (
              <div className="max-h-[31rem] overflow-auto overscroll-contain rounded-xl border border-slate-200" aria-label="Predicted versus actual results">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase text-slate-400"><tr><th className="p-3">Unit</th><th>Forecast month</th><th>Model</th><th>Predicted</th><th>Actual</th><th>Absolute error</th><th>Status</th></tr></thead>
                  <tbody className="divide-y divide-slate-300">
                    {data.diagnostics.map((row) => (
                      <tr key={`${row.unitId}-${row.forecastForMonth}`} className={row.status !== 'READY' || row.actualValidationStatus !== 'VALID' ? 'bg-amber-50' : ''}>
                        <td className="p-3 font-bold">Unit {row.unitNumber}</td>
                        <td>{String(row.forecastForMonth).slice(0, 10)}</td>
                        <td className="text-xs font-semibold text-slate-600">{String(row.modelName || 'LINEAR_REGRESSION').replaceAll('_', ' ')}</td>
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

          <section><button type="button" onClick={() => setShowForecastQuality((current) => !current)} aria-expanded={showForecastQuality} className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-white px-4 py-2.5 text-sm font-bold text-emerald-800 shadow-sm transition hover:border-emerald-700 hover:bg-emerald-700 hover:text-white"><ChartNoAxesCombined size={17} />{showForecastQuality ? 'Hide forecast quality metrics' : 'Show forecast quality metrics'}</button>{showForecastQuality && <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><Metric label="Holdout month" value={month(data?.evaluationMonth)} accent={analyticsAccents[0]} icon={CalendarDays} /><Metric label="WAPE accuracy" value={valueOrDash(metrics.accuracy, '%')} accent={analyticsAccents[1]} icon={Gauge} /><Metric label="MAE" value={valueOrDash(metrics.mae, ' m3')} accent={analyticsAccents[2]} icon={Activity} /><Metric label="RMSE" value={valueOrDash(metrics.rmse, ' m3')} accent={analyticsAccents[3]} icon={ChartNoAxesCombined} /><Metric label="Evaluated / excluded" value={`${metrics.evaluatedCount || 0} / ${metrics.excludedCount || 0}`} accent={analyticsAccents[4]} icon={ListChecks} /></div>}</section>

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

function Metric({ accent, icon: Icon, label, value, compact = false }) {
  return <div className={`${accent ? `collector-metric collector-metric-${accent}` : ''} rounded-2xl border border-slate-200 bg-white ${compact ? 'p-4 shadow-none' : 'p-5 shadow-sm'}`}><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p><p className={`${compact ? 'mt-2 text-xl' : 'mt-3 text-2xl'} font-black text-[var(--ink)]`}>{value}</p></div>{Icon && <span className="grid size-10 shrink-0 place-items-center rounded-xl"><Icon size={19} /></span>}</div></div>
}

function ChartCard({ title, description, filter, children }) {
  return (
    <div className="collector-chart-panel min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="text-base font-black text-[var(--ink)]">{title}</h3><p className="mt-1 text-sm text-[var(--muted)]">{description}</p></div>{filter}</div>
      <div className="mt-5 h-72">{children}</div>
    </div>
  )
}

function ForecastRangeFilter({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const selected = forecastRanges.find((option) => option.value === value) || forecastRanges[2]

  function selectRange(nextValue) {
    onChange(nextValue)
    setOpen(false)
  }

  return <div className="relative w-44 shrink-0"><p className="mb-1 text-[11px] font-medium text-[var(--muted)]">Viewing</p><button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)} className="flex w-full items-center justify-between gap-2 rounded-lg border border-emerald-600 bg-white px-3 py-1.5 text-left text-xs font-bold text-emerald-700 shadow-sm outline-none transition hover:bg-emerald-50 focus:ring-2 focus:ring-emerald-200"><span>Last {selected.label}</span><ChevronDown size={15} className={`shrink-0 transition ${open ? 'rotate-180' : ''}`} /></button>{open && <div className="absolute right-0 top-[calc(100%+6px)] z-10 w-48 rounded-xl border border-slate-200 bg-white p-2 shadow-xl" role="listbox" aria-label="Forecast statistical filter"><p className="px-2 pb-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-[var(--muted)]">Forecast range</p><div className="grid grid-cols-2 gap-1">{forecastRanges.map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === value} onClick={() => selectRange(option.value)} className={`rounded-md px-2 py-1.5 text-left text-[11px] font-bold transition ${option.value === value ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-emerald-50 hover:text-emerald-700'}`}>Last {option.label}</button>)}</div></div>}</div>
}

function recommendationTypeLabel(type) {
  return {
    CHECK_HIGH_USAGE: 'High water use',
    VACANT_UNIT_USAGE: 'Vacant-unit usage',
    RISING_CONSUMPTION: 'Rising consumption',
    PAYMENT_REMINDER: 'Payment reminder',
    MONITOR_HIGH_USAGE: 'Monitor high usage',
    COLLECT_MORE_HISTORY: 'More reading history',
    MONITOR_USAGE: 'Usage monitoring',
  }[type] || String(type || 'Recommendation').replaceAll('_', ' ')
}

function recommendationEvidence(recommendation) {
  const evidence = recommendation.evidence || {}
  if (recommendation.recommendationType === 'CHECK_HIGH_USAGE') {
    return `${Number(evidence.predictedConsumption || 0).toFixed(3)} m3 projected versus ${Number(evidence.recentAverage || 0).toFixed(3)} m3 recent average (+${Number(evidence.increasePercent || 0).toFixed(2)}%).`
  }
  if (recommendation.recommendationType === 'VACANT_UNIT_USAGE') return `${Number(evidence.latestConsumption || 0).toFixed(3)} m3 recorded while the unit is vacant.`
  if (recommendation.recommendationType === 'RISING_CONSUMPTION') return `Recent readings: ${(evidence.values || []).map((value) => `${Number(value).toFixed(3)} m3`).join(', ')}.`
  if (recommendation.recommendationType === 'PAYMENT_REMINDER') return `Due ${String(evidence.dueDate || '').slice(0, 10)} with PHP ${Number(evidence.remainingBalance || 0).toFixed(2)} remaining.`
  if (recommendation.recommendationType === 'MONITOR_HIGH_USAGE') return `${Number(evidence.predictedConsumption || 0).toFixed(3)} m3 projected; recent high is ${Number(evidence.recentHigh || 0).toFixed(3)} m3.`
  if (recommendation.recommendationType === 'COLLECT_MORE_HISTORY') {
    return `${evidence.missingMonths || 0} more valid monthly reading${Number(evidence.missingMonths) === 1 ? '' : 's'} needed.`
  }
  if (recommendation.recommendationType === 'MONITOR_USAGE') return `Positive baseline readings: ${Number(evidence.positiveBaselineCount || 0)}; zero readings: ${Number(evidence.zeroReadingCount || 0)}; forecast: ${evidence.predictedConsumption === null || evidence.predictedConsumption === undefined ? 'not available' : `${Number(evidence.predictedConsumption).toFixed(3)} m3`}.`
  return evidence.reason || 'The latest meter reading is not valid for forecasting.'
}

function ActionButton({ children, ...props }) {
  return <button {...props} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50">{children}</button>
}
