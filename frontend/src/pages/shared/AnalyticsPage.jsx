import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, CalendarDays, ChartNoAxesCombined, ChevronDown, Gauge, ListChecks, RefreshCw } from 'lucide-react'
import {
  Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'
import { chartNumber as number, connectForecastLine } from '../../utils/forecastChart'
import { forecastModelLabel } from '../../utils/forecastModelLabel'

function valueOrDash(value, suffix = '') {
  return value === null || value === undefined ? '-' : `${Number(value).toFixed(2)}${suffix}`
}

function month(value) {
  return value ? new Date(value).toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'No evaluated month'
}

function monthLabel(value) {
  return new Date(value).toLocaleDateString('en-PH', { month: 'short', year: 'numeric', timeZone: 'UTC' })
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
  const prescriptiveRecommendationsRef = useRef(null)
  const [consumptionRange, setConsumptionRange] = useState('sixMonths')
  const [waterBillRange, setWaterBillRange] = useState('sixMonths')
  const [showForecastQuality, setShowForecastQuality] = useState(false)
  const [refreshingForecasts, setRefreshingForecasts] = useState(false)
  const [confirmation, setConfirmation] = useState(null)
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

  useEffect(() => {
    if (showAllRecommendations) prescriptiveRecommendationsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [showAllRecommendations])

  async function deleteRecommendation(recommendation) {
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
    setRefreshingForecasts(true)
    setError('')
    try {
      await apiRequest('/api/analytics/refresh-forecasts', { method: 'POST', token })
      const [analyticsData, recommendationData] = await Promise.all([
        apiRequest('/api/analytics/overview', { token }),
        apiRequest('/api/prescriptive-recommendations', { token }),
      ])
      setData(analyticsData)
      setRecommendations(recommendationData.recommendations || [])
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setRefreshingForecasts(false)
    }
  }

  async function confirmAction() {
    const action = confirmation
    if (!action) return

    if (action.type === 'REFRESH_FORECASTS') await refreshForecasts()
    if (action.type === 'DELETE_RECOMMENDATION') await deleteRecommendation(action.recommendation)
    setConfirmation(null)
  }

  const metrics = data?.metrics || {}
  const latestEvaluation = data?.evaluationHistory?.find((row) => row.forecastForMonth === data.evaluationMonth)
  const usageReview = latestEvaluation?.usageReview
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
    const priority = { HIGH: 0, LOW: 1 }
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
  const visibleRecommendations = showAllRecommendations ? sortedRecommendations : sortedRecommendations.slice(0, 5)

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
          <div className="mb-4 flex justify-end"><button type="button" onClick={() => setConfirmation({ type: 'REFRESH_FORECASTS' })} disabled={refreshingForecasts} className="inline-flex items-center gap-2 rounded-lg border border-emerald-600 bg-white px-4 py-2.5 text-sm font-bold text-emerald-700 transition hover:bg-emerald-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"><RefreshCw size={16} className={refreshingForecasts ? 'animate-spin' : ''} />{refreshingForecasts ? 'Refreshing forecasts...' : 'Refresh forecasts'}</button></div>
          <Panel title="Latest forecast coverage" description="A unit needs five consecutive valid monthly readings after any meter reset or continuity break.">
            {!data ? <EmptyRow message="Loading forecast coverage..." /> : (
              <div className="grid gap-4 sm:grid-cols-3">
                <Metric label="Forecast month" value={month(data.latestForecast.forecastForMonth)} compact />
                <Metric label="Ready" value={data.latestForecast.ready || 0} compact />
                <Metric label="Excluded / insufficient" value={data.latestForecast.excluded || 0} compact />
              </div>
            )}
          </Panel>

          <section>
            <button type="button" onClick={() => setShowForecastQuality((current) => !current)} aria-expanded={showForecastQuality} className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-white px-4 py-2.5 text-sm font-bold text-emerald-800 shadow-sm transition hover:border-emerald-700 hover:bg-emerald-700 hover:text-white"><ChartNoAxesCombined size={17} />{showForecastQuality ? 'Hide forecast quality metrics' : 'Show forecast quality metrics'}</button>
            {showForecastQuality && <div className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <Metric label="Holdout month" value={month(data?.evaluationMonth)} accent="blue" icon={CalendarDays} />
                <Metric label="Overall derived accuracy" value={valueOrDash(metrics.accuracy, '%')} accent="green" icon={Gauge} />
                <Metric label="WAPE error" value={valueOrDash(metrics.wape, '%')} accent="red" icon={Activity} />
                <Metric label="MAE" value={valueOrDash(metrics.mae, ' m3')} accent="green" icon={Activity} />
                <Metric label="RMSE" value={valueOrDash(metrics.rmse, ' m3')} accent="blue" icon={ChartNoAxesCombined} />
                <Metric label="Evaluated / excluded" value={`${metrics.evaluatedCount || 0} / ${metrics.excludedCount || 0}`} accent="green" icon={ListChecks} />
              </div>
              {usageReview && <UsageQualityPanel review={usageReview} overallCount={metrics.evaluatedCount || 0} evaluatedMonth={latestEvaluation.forecastForMonth} />}
              <Panel title="Monthly forecast comparison" description="Retrospective evaluation: each forecast uses only readings before the evaluated month. Historical forecasts may be recalculated when you refresh.">
                <p className="mb-4 text-sm leading-6 text-slate-600">Lower MAE, RMSE, and WAPE indicate smaller prediction errors. Derived accuracy = max(0, 100 − WAPE); it is not a probability. WAPE and accuracy are unavailable when total actual consumption is zero.</p>
                {data?.evaluationHistory?.length ? <MonthlyComparisonTable rows={data.evaluationHistory.slice(-12)} /> : <EmptyRow message="Import a later actual month to compare forecasts with readings." />}
                <p className="mt-3 text-xs text-slate-500">Model and baseline scores use the same eligible units in each month. Coverage can change between months.</p>
              </Panel>
              {latestEvaluation?.metrics.evaluatedCount > 0 && latestEvaluation.totals && (
                <Panel title={`What contributed to ${monthLabel(latestEvaluation.forecastForMonth)} errors?`} description="These totals and units use the same valid forecast and actual pairs as the quality score.">
                  <div className="mb-4 grid gap-3 sm:grid-cols-2">
                    <Metric label="Total actual consumption" value={valueOrDash(latestEvaluation.totals.actualConsumption, ' m³')} compact />
                    <Metric label="Total absolute forecast error" value={valueOrDash(latestEvaluation.totals.absoluteError, ' m³')} compact />
                  </div>
                  <p className="mb-4 text-sm leading-6 text-slate-600">WAPE = total absolute error ÷ total actual consumption × 100. A lower actual total or a few large unit errors can lower the monthly accuracy score. Sudden usage changes may need a meter or occupancy review.</p>
                  <div className="overflow-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-[550px] text-left text-sm">
                      <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-3">Largest errors</th><th className="p-3">Predicted (m³)</th><th className="p-3">Actual (m³)</th><th className="p-3">Error (m³)</th><th className="p-3">Share of total error</th></tr></thead>
                      <tbody className="divide-y divide-slate-200">{latestEvaluation.topErrorUnits?.map((row) => <tr key={row.unitId}>
                        <td className="p-3 font-bold">Unit {row.unitNumber}</td><td className="p-3">{valueOrDash(row.predictedConsumption)}</td><td className="p-3">{valueOrDash(row.actualConsumption)}</td><td className="p-3">{valueOrDash(row.absoluteError)}</td><td className="p-3">{valueOrDash(row.errorShare, '%')}</td>
                      </tr>)}</tbody>
                    </table>
                  </div>
                </Panel>
              )}
            </div>}
          </section>

          <div className="grid gap-6 xl:grid-cols-2">
            <ChartCard title="Historical vs Projected Water Consumption" description="Monthly total consumption in cubic meters." filter={<ForecastRangeFilter value={consumptionRange} onChange={setConsumptionRange} />}>
              {consumptionChartData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={consumptionChartData} margin={{ top: 10, right: 16, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" angle={-25} textAnchor="end" height={70} interval={0} tickMargin={8} tick={{ fontSize: 11 }} />
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
                    <XAxis dataKey="label" angle={-25} textAnchor="end" height={70} interval={0} tickMargin={8} tick={{ fontSize: 11 }} />
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

          <div ref={prescriptiveRecommendationsRef} className="scroll-mt-20">
          <Panel title="Prescriptive Recommendations" description="A prioritized action queue for the latest billing batch forwarded to Admin.">
            <div className="mb-5 grid gap-3 sm:grid-cols-3">
              <Metric label="Action needed" value={recommendationSummary.active} compact />
              <Metric label="High priority" value={recommendationSummary.high} compact />
              <Metric label="Units affected" value={recommendationSummary.units} compact />
            </div>
            {recommendations.length ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-black text-slate-900">Action queue</p><p className="mt-0.5 text-sm text-slate-500">Find the most urgent recommendation, then open it for the supporting evidence.</p></div><p className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600 ring-1 ring-slate-200">{sortedRecommendations.length} matching</p></div><div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_170px_180px]"><label className="text-xs font-bold text-slate-600">Search<input type="search" value={recommendationSearch} onChange={(event) => { setRecommendationSearch(event.target.value); setShowAllRecommendations(false) }} placeholder="Unit, action, or condition..." className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" /></label><label className="text-xs font-bold text-slate-600">Priority<select value={recommendationPriority} onChange={(event) => { setRecommendationPriority(event.target.value); setShowAllRecommendations(false) }} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"><option value="ALL">All priorities</option><option value="LOW">Low priority</option><option value="HIGH">High priority</option></select></label><label className="text-xs font-bold text-slate-600">Sort by<select value={recommendationSort} onChange={(event) => setRecommendationSort(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"><option value="PRIORITY">Priority: high first</option><option value="UNIT">Unit number</option></select></label></div></div>
                <div className={showAllRecommendations ? 'max-h-[40rem] space-y-3 overflow-y-auto overscroll-contain pr-2' : 'space-y-3'} aria-label="Prescriptive recommendations">
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
                            <ActionButton disabled={busy} onClick={() => setConfirmation({ type: 'DELETE_RECOMMENDATION', recommendation })}>{busy ? 'Deleting...' : 'Delete'}</ActionButton>
                          </div>
                        </div>
                        {expanded && <div className="mt-4 border-t border-slate-100 pt-4"><p className="text-xs font-bold capitalize tracking-wide text-slate-400">Condition detected</p><p className="mt-1 font-bold text-slate-900">{recommendation.evidence?.condition || recommendationEvidence(recommendation)}</p><p className="mt-3 text-xs font-bold capitalize tracking-wide text-slate-400">Recommended action</p><p className="mt-1 font-black text-slate-950">{recommendation.message}</p><p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{recommendationEvidence(recommendation)}</p></div>}
                      </article>
                    )
                  })}
                  {sortedRecommendations.length === 0 && <EmptyRow message="No recommendations match the selected search or priority." />}
                </div>
                {sortedRecommendations.length > 5 && (
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
          </div>

          <Panel title="Predicted versus actual" description={`Visible to ${user.role === 'ADMIN' ? 'Admin' : 'Billing Associate'} staff only. WAPE avoids division problems for units with zero consumption.`}>
            {data?.diagnostics.length ? (
              <div className="max-h-[31rem] overflow-auto overscroll-contain rounded-xl border border-slate-200" aria-label="Predicted versus actual results">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-xs capitalize text-slate-400"><tr><th className="p-3">Unit</th><th>Forecast month</th><th>Model</th><th>Predicted</th><th>Actual</th><th>Absolute error</th><th>Status</th></tr></thead>
                  <tbody className="divide-y divide-slate-300">
                    {data.diagnostics.map((row) => (
                      <tr key={`${row.unitId}-${row.forecastForMonth}`} className={row.status !== 'READY' || row.actualValidationStatus !== 'VALID' ? 'bg-amber-50' : ''}>
                        <td className="p-3 font-bold">Unit {row.unitNumber}</td>
                        <td>{String(row.forecastForMonth).slice(0, 10)}</td>
                        <td className="text-xs font-semibold text-slate-600">{forecastModelLabel(row.modelName)}</td>
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
      {confirmation && <ConfirmationModal
        busy={confirmation.type === 'REFRESH_FORECASTS' ? refreshingForecasts : recommendationBusyId === confirmation.recommendation.id}
        confirmLabel={confirmation.type === 'REFRESH_FORECASTS' ? 'Refresh Forecasts' : 'Delete Recommendation'}
        danger={confirmation.type === 'DELETE_RECOMMENDATION'}
        message={confirmation.type === 'REFRESH_FORECASTS' ? 'Recalculate forecasts for all visible historical imports and forwarded or closed billing periods, then update recommendations? Historical scores will be retrospective evaluations.' : `Permanently delete the recommendation for Unit ${confirmation.recommendation.unitNumber}?`}
        onCancel={() => setConfirmation(null)}
        onConfirm={confirmAction}
        title={confirmation.type === 'REFRESH_FORECASTS' ? 'Refresh Forecasts?' : 'Delete Recommendation?'}
      />}
    </DashboardLayout>
  )
}

function Metric({ accent, icon: Icon, label, value, compact = false }) {
  return <div className={`${accent ? `collector-metric collector-metric-${accent}` : ''} rounded-2xl border border-slate-200 bg-white ${compact ? 'p-4 shadow-none' : 'p-5 shadow-sm'}`}><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-xs font-bold capitalize tracking-wide text-slate-400">{label}</p><p className={`${compact ? 'mt-2 text-xl' : 'mt-3 text-2xl'} font-black text-[var(--ink)]`}>{value}</p></div>{Icon && <span className="grid size-10 shrink-0 place-items-center rounded-xl"><Icon size={19} /></span>}</div></div>
}

function MonthlyComparisonTable({ rows }) {
  const latestMonth = rows.filter((row) => row.metrics.evaluatedCount > 0).at(-1)?.forecastForMonth
  const headerClass = 'px-2 py-2.5 text-center text-[11px] font-semibold leading-4'
  const numericClass = 'whitespace-nowrap px-2 py-3.5 text-right tabular-nums'
  return <div>
    <div className="overflow-x-auto rounded-xl border border-slate-200" role="region" aria-label="Monthly forecast comparison" tabIndex={0}>
      <table className="w-full min-w-[820px] table-fixed text-left text-xs">
        <caption className="sr-only">Monthly overall forecast errors, typical-usage quality, and baseline errors. All error amounts are in cubic meters; WAPE and accuracy are percentages.</caption>
        <colgroup><col className="w-[12%]" /><col className="w-[12%]" /><col className="w-[9%]" /><col className="w-[9%]" /><col className="w-[10%]" /><col className="w-[10%]" /><col className="w-[12%]" /><col className="w-[12%]" /><col className="w-[14%]" /></colgroup>
        <thead className="text-slate-600">
          <tr className="border-b border-slate-200 bg-slate-50">
            <th rowSpan={2} scope="col" className="whitespace-nowrap px-3 py-3 text-left text-xs font-bold">Month</th>
            <th rowSpan={2} scope="col" className={headerClass}>Evaluated<span className="block font-normal text-slate-500">/ excluded</span></th>
            <th colSpan={3} scope="colgroup" className={`${headerClass} border-l border-slate-200`}>Overall forecast errors</th>
            <th colSpan={2} scope="colgroup" className={`${headerClass} border-l border-emerald-200 bg-emerald-50 text-emerald-800`}>Typical usage</th>
            <th colSpan={2} scope="colgroup" className={`${headerClass} border-l border-slate-200`}>Baseline WAPE</th>
          </tr>
          <tr className="border-b border-slate-200 bg-slate-50/60">
            <th scope="col" className={`${headerClass} border-l border-slate-200`}>MAE<span className="block font-normal text-slate-500">m³</span></th>
            <th scope="col" className={headerClass}>RMSE<span className="block font-normal text-slate-500">m³</span></th>
            <th scope="col" className={headerClass}>WAPE<span className="block font-normal text-slate-500">error %</span></th>
            <th scope="col" className={`${headerClass} border-l border-emerald-200 bg-emerald-50/60`}>Accuracy<span className="block font-normal text-slate-500">%</span></th>
            <th scope="col" className={`${headerClass} bg-emerald-50/60`}>Units<span className="block font-normal text-slate-500">/ alerts</span></th>
            <th scope="col" className={`${headerClass} border-l border-slate-200`}>Last month</th>
            <th scope="col" className={headerClass}>3-mo. average</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">{rows.map((row) => {
          const isLatest = row.forecastForMonth === latestMonth
          const hasPairs = row.metrics.evaluatedCount > 0
          return <tr key={row.forecastForMonth} className={isLatest ? 'bg-emerald-50/70 font-semibold' : hasPairs ? 'transition hover:bg-slate-50' : 'bg-slate-50/40 text-slate-400'}>
            <th scope="row" className="whitespace-nowrap px-3 py-3.5 text-left font-bold" title={isLatest ? 'Latest evaluated month' : undefined}>{monthLabel(row.forecastForMonth)}</th>
            <td className="whitespace-nowrap px-2 py-3.5 text-center tabular-nums">{row.metrics.evaluatedCount} / {row.metrics.excludedCount}</td>
            <td className={`${numericClass} border-l border-slate-200`}>{valueOrDash(row.metrics.mae)}</td>
            <td className={numericClass}>{valueOrDash(row.metrics.rmse)}</td>
            <td className={numericClass}>{valueOrDash(row.metrics.wape, '%')}</td>
            <td className={`${numericClass} border-l border-emerald-200`}>{valueOrDash(row.usageReview?.typicalMetrics.accuracy, '%')}</td>
            <td className="whitespace-nowrap px-2 py-3.5 text-center tabular-nums">{row.usageReview ? `${row.usageReview.typicalMetrics.evaluatedCount} / ${row.usageReview.alertCount}` : '-'}</td>
            <td className={`${numericClass} border-l border-slate-200`}>{valueOrDash(row.baselines.lastMonth.wape, '%')}</td>
            <td className={numericClass}>{valueOrDash(row.baselines.recentAverage.wape, '%')}</td>
          </tr>
        })}</tbody>
      </table>
    </div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
      <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />Latest evaluated month is highlighted.</span>
      <span>— means no available score. Scroll horizontally on smaller screens.</span>
    </div>
  </div>
}

function UsageQualityPanel({ review, overallCount, evaluatedMonth }) {
  const typical = review.typicalMetrics
  const alertLabels = { USAGE_SPIKE: 'Usage spike', USAGE_DROP: 'Usage drop', ZERO_AFTER_REGULAR_USE: 'Zero after regular use' }
  return <Panel title={`Typical-usage quality · ${monthLabel(evaluatedMonth)}`} description="A secondary score for units whose actual consumption stayed within the usage-review rules. The overall score above still includes every valid evaluated unit.">
    <div className="grid gap-3 sm:grid-cols-3">
      <Metric label="Typical derived accuracy" value={valueOrDash(typical.accuracy, '%')} compact />
      <Metric label="Typical WAPE" value={valueOrDash(typical.wape, '%')} compact />
      <Metric label="Typical / all evaluated units" value={`${typical.evaluatedCount} / ${overallCount}`} compact />
    </div>
    <p className="mt-3 text-sm leading-6 text-slate-600">{review.alertCount} usage-change {review.alertCount === 1 ? 'alert is' : 'alerts are'} outside this secondary score and {review.alertCount === 1 ? 'accounts' : 'account'} for {valueOrDash(review.alertErrorShare, '%')} of the overall absolute error. This filtered score describes typical usage only; it is not the overall forecast accuracy or a guarantee of future results.</p>
    <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
      <summary className="cursor-pointer font-bold text-slate-700">How usage changes are identified</summary>
      <p className="mt-2 leading-6">Compare actual usage with the median of the previous {review.rule.historyMonths} consecutive valid months. A large change must exceed the greatest of {review.rule.minimumChange} m³, {review.rule.relativeChange * 100}% of that median, or {review.rule.deviationMultiplier} times the median absolute deviation of those readings. Zero usage also prompts review after {review.rule.positiveMonthsBeforeZero} positive months when the prior median is at least {review.rule.zeroBaselineMinimum} m³.</p>
      <p className="mt-2 leading-6">Alerts use earlier readings and current actual usage, independently of forecast error. They do not mark a reading invalid or remove it from model training. The secondary score uses the same accuracy formula, on the remaining units; it is unavailable when their total actual consumption is zero.</p>
    </details>
    <div className={`mt-4 rounded-xl border p-4 ${review.alertCount ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
      <p className="font-bold text-slate-900">{review.alertCount ? `${review.alertCount} units need a usage review` : 'No unusual usage changes detected'}</p>
      <p className="mt-1 text-sm text-slate-600">{review.alertCount ? 'Check original meter readings, occupancy changes, and possible leaks. Confirm the cause before correcting a reading.' : 'All valid evaluated units are included in the typical-usage score.'}</p>
      {review.alertCount > 0 && <details className="mt-3">
        <summary className="cursor-pointer text-sm font-bold text-amber-900">View all usage-change alerts</summary>
        <div className="mt-3 max-h-96 overflow-auto rounded-lg border border-amber-200 bg-white">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead className="sticky top-0 bg-amber-50 text-xs text-slate-600"><tr><th className="p-3">Unit</th><th className="p-3">Review reason</th><th className="p-3">Prior median (m³)</th><th className="p-3">Actual (m³)</th><th className="p-3">Predicted (m³)</th><th className="p-3">Error (m³)</th><th className="p-3">Share of total error</th></tr></thead>
            <tbody className="divide-y divide-amber-100">{review.alerts.map((row) => <tr key={row.unitId}>
              <td className="p-3 font-bold">Unit {row.unitNumber}</td><td className="p-3">{alertLabels[row.type] || 'Usage change'}</td><td className="p-3">{valueOrDash(row.usualConsumption)}</td><td className="p-3">{valueOrDash(row.actualConsumption)}</td><td className="p-3">{valueOrDash(row.predictedConsumption)}</td><td className="p-3">{valueOrDash(row.absoluteError)}</td><td className="p-3">{valueOrDash(row.errorShare, '%')}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </details>}
    </div>
  </Panel>
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

  return <div className="relative w-44 shrink-0"><p className="mb-1 text-[11px] font-medium text-[var(--muted)]">Viewing</p><button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)} className="flex w-full items-center justify-between gap-2 rounded-lg border border-emerald-600 bg-white px-3 py-1.5 text-left text-xs font-bold text-emerald-700 shadow-sm outline-none transition hover:bg-emerald-50 focus:ring-2 focus:ring-emerald-200"><span>Last {selected.label}</span><ChevronDown size={15} className={`shrink-0 transition ${open ? 'rotate-180' : ''}`} /></button>{open && <div className="absolute right-0 top-[calc(100%+6px)] z-10 w-48 rounded-xl border border-slate-200 bg-white p-2 shadow-xl" role="listbox" aria-label="Forecast statistical filter"><p className="px-2 pb-1.5 text-[10px] font-black capitalize tracking-[0.14em] text-[var(--muted)]">Forecast range</p><div className="grid grid-cols-1 gap-1">{forecastRanges.map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === value} onClick={() => selectRange(option.value)} className={`rounded-md px-2 py-1.5 text-left text-[11px] font-bold transition ${option.value === value ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-emerald-50 hover:text-emerald-700'}`}>Last {option.label}</button>)}</div></div>}</div>
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

function ConfirmationModal({ busy, confirmLabel, danger, message, onCancel, onConfirm, title }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" role="presentation" onMouseDown={() => { if (!busy) onCancel() }}>
    <section role="dialog" aria-modal="true" aria-labelledby="analytics-confirmation-title" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6" onMouseDown={(event) => event.stopPropagation()}>
      <h2 id="analytics-confirmation-title" className="text-lg font-black text-slate-900">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{message}</p>
      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="button" disabled={busy} onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Cancel</button>
        <button type="button" disabled={busy} onClick={onConfirm} className={`rounded-lg px-4 py-2.5 text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-700 hover:bg-emerald-800'}`}>{busy ? 'Working...' : confirmLabel}</button>
      </div>
    </section>
  </div>
}
