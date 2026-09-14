import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Activity, ChevronDown, CreditCard, FileCheck2, Lightbulb, ListFilter, ReceiptText } from 'lucide-react'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

function number(value) {
  return value === null || value === undefined ? null : Number(value)
}

function monthLabel(value) {
  return new Date(value).toLocaleDateString('en-PH', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function money(value) {
  return value === null || value === undefined ? 'Unavailable' : `PHP ${Number(value).toFixed(2)}`
}

function displayName(value) {
  return String(value || '').split(/\s+/).filter(Boolean).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`).join(' ')
}

function paddedDomain(values) {
  const numericValues = values.filter((value) => Number.isFinite(value))
  if (!numericValues.length) return ['auto', 'auto']
  const min = Math.min(...numericValues)
  const max = Math.max(...numericValues)
  const spread = Math.max(max - min, 1)
  const padding = spread * 0.2
  return [Math.max(0, Math.floor((min - padding) * 1000) / 1000), Math.ceil((max + padding) * 1000) / 1000]
}

function latestMeterResetIndex(history) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const reading = history[index]
    const notes = Array.isArray(reading.validationNotes) ? reading.validationNotes.join(' ') : String(reading.validationNotes || '')
    if (notes.toLowerCase().includes('meter reset recorded')) return index

    const priorReading = history[index - 1]
    if (priorReading
      && Number(reading.previousReading) <= 0.001
      && Number(priorReading.currentReading) > Number(reading.currentReading) + 0.001) return index
  }
  return -1
}

export default function ResidentDashboard() {
  const { token, user } = useAuth()
  const [bills, setBills] = useState([])
  const [payments, setPayments] = useState([])
  const [analyticsUnits, setAnalyticsUnits] = useState([])
  const [recommendations, setRecommendations] = useState([])
  const [selectedUnitId, setSelectedUnitId] = useState('')
  const [chartRange, setChartRange] = useState('RESET')
  const [chartRangeMenuOpen, setChartRangeMenuOpen] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      apiRequest('/api/bills', { token }),
      apiRequest('/api/payments', { token }),
      apiRequest('/api/analytics/resident', { token }),
      apiRequest('/api/prescriptive-recommendations/resident', { token }),
    ])
      .then(([billData, paymentData, analyticsData, recommendationData]) => {
        setBills(billData.bills)
        setPayments(paymentData.payments)
        setAnalyticsUnits(analyticsData.units)
        setRecommendations(recommendationData.recommendations || [])
        setSelectedUnitId((current) => current || String(analyticsData.units[0]?.id || ''))
      })
      .catch((requestError) => setError(requestError.message))
  }, [token])

  const summary = useMemo(() => ({
    publishedSoas: bills.length,
    unpaid: bills.filter((bill) => ['UNPAID', 'OVERDUE'].includes(bill.paymentStatus)).length,
    pendingPayments: payments.filter((payment) => payment.reviewStatus === 'PENDING').length,
  }), [bills, payments])

  const selectedUnit = useMemo(
    () => analyticsUnits.find((unit) => String(unit.id) === selectedUnitId) || analyticsUnits[0],
    [analyticsUnits, selectedUnitId],
  )
  const selectedRecommendations = useMemo(
    () => recommendations.filter((recommendation) => String(recommendation.unitId) === String(selectedUnit?.id)),
    [recommendations, selectedUnit],
  )
  const allInsightsPositive = selectedRecommendations.length > 0 && selectedRecommendations.every(isPositiveInsight)
  const history = useMemo(() => selectedUnit?.history || [], [selectedUnit?.history])
  const resetIndex = useMemo(() => latestMeterResetIndex(history), [history])
  const historySinceReset = useMemo(() => (resetIndex >= 0 ? history.slice(resetIndex) : history), [history, resetIndex])
  const chartHistory = useMemo(() => {
    const baseHistory = chartRange === 'RESET' ? historySinceReset : history
    const monthCount = Number(chartRange)
    return Number.isInteger(monthCount) ? baseHistory.slice(-monthCount) : baseHistory
  }, [chartRange, history, historySinceReset])
  const validHistory = useMemo(() => historySinceReset.filter((reading) => reading.validationStatus === 'VALID'), [historySinceReset])
  const validChartHistory = useMemo(() => chartHistory.filter((reading) => reading.validationStatus === 'VALID'), [chartHistory])
  const latestReading = validHistory.at(-1)
  const recentAverage = validHistory.length
    ? validHistory.slice(-5).reduce((sum, reading) => sum + number(reading.consumption), 0) / Math.min(5, validHistory.length)
    : null
  const forecast = selectedUnit?.forecast

  const consumptionData = useMemo(() => {
    const rows = chartHistory.map((reading) => ({
      label: monthLabel(reading.periodStart),
      actual: reading.validationStatus === 'VALID' ? number(reading.consumption) : null,
      predicted: null,
      status: reading.validationStatus,
    }))
    if (forecast?.status === 'READY' && rows.length) {
      rows.push({
        label: `${monthLabel(forecast.forecastForMonth)} estimate`,
        actual: null,
        predicted: number(forecast.predictedConsumption),
        status: 'FORECAST',
      })
    }
    return rows
  }, [chartHistory, forecast])

  const meterData = useMemo(() => {
    const rows = validChartHistory.map((reading) => ({
      label: monthLabel(reading.periodStart),
      actual: number(reading.currentReading),
      predicted: null,
    }))
    const latestMeterReading = rows.at(-1)?.actual
    if (forecast?.status === 'READY' && Number.isFinite(latestMeterReading)) {
      rows[rows.length - 1].predicted = latestMeterReading
      rows.push({
        label: `${monthLabel(forecast.forecastForMonth)} estimate`,
        actual: null,
        predicted: latestMeterReading + number(forecast.predictedConsumption),
      })
    }
    return rows
  }, [forecast, validChartHistory])
  const meterDomain = useMemo(() => paddedDomain(meterData.flatMap((row) => [row.actual, row.predicted])), [meterData])

  return (
    <DashboardLayout title="Resident dashboard" description="View published SOAs, payment status, water analytics, and personalized recommendations.">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <section className="resident-welcome"><div><p className="text-sm font-bold uppercase tracking-[0.16em] text-[var(--primary)]">Resident portal</p><h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">Welcome back, {displayName(user.fullName)}</h1><p className="mt-2 text-sm text-slate-500">Unit {selectedUnit?.unitNumber || '—'} <span className="mx-1 text-slate-300">·</span> RSG Residences</p></div><div className="resident-welcome-mark"><Activity size={22} /></div></section>

      <div className="grid gap-4 md:grid-cols-3">
        <DashboardCard icon={FileCheck2} label="Published SOAs" value={summary.publishedSoas} accent="blue" />
        <DashboardCard icon={CreditCard} label="Need payment" value={summary.unpaid} accent="green" />
        <DashboardCard icon={ReceiptText} label="Pending payment reviews" value={summary.pendingPayments} accent="red" />
      </div>

      <Panel title="Water consumption analytics" description="Forecasts are estimates based on five consecutive valid monthly readings and do not replace your actual bill.">
        {analyticsUnits.length === 0 ? <EmptyRow message="No analytics data yet. Import historical readings first." /> : (
          <div className="space-y-6">
            <div className="flex flex-col gap-3 rounded-xl bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Current unit</p>
                <p className="mt-1 text-2xl font-black text-slate-950">Unit {selectedUnit?.unitNumber}</p>
              </div>
              {analyticsUnits.length > 1 && (
                <label className="block w-full max-w-xs text-sm font-bold text-slate-700">
                  Change unit
                  <select value={selectedUnitId} onChange={(event) => setSelectedUnitId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
                    {analyticsUnits.map((unit) => <option key={unit.id} value={unit.id}>Unit {unit.unitNumber}</option>)}
                  </select>
                </label>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Latest consumption" value={latestReading ? `${number(latestReading.consumption).toFixed(3)} m³` : 'Unavailable'} />
              <MetricCard label="Recent 5-month average" value={recentAverage === null ? 'Unavailable' : `${recentAverage.toFixed(3)} m³`} />
              <MetricCard label="Next-month estimate" value={forecast?.status === 'READY' ? `${number(forecast.predictedConsumption).toFixed(3)} m³` : 'Not enough valid data'} />
              <MetricCard label="Estimated water charge" value={forecast?.status === 'READY' ? money(forecast.estimatedWaterCharge) : 'Unavailable'} />
            </div>

            <div className="resident-chart-controls">
              <div className="flex min-w-0 items-start gap-3">
                <span className="resident-chart-control-icon"><Activity size={17} aria-hidden="true" /></span>
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-800">Chart history</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{resetIndex >= 0 ? `A meter reset was recorded in ${monthLabel(history[resetIndex].periodStart)}. Old-meter readings are hidden by default.` : 'Choose how many recent months to show.'}</p>
                </div>
              </div>
              <label className="resident-chart-select-label">
                <span>Viewing</span>
                <span className="relative block">
                  <button type="button" aria-expanded={chartRangeMenuOpen} onClick={() => setChartRangeMenuOpen((current) => !current)} className="resident-range-selector">
                    <ListFilter size={15} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-left">{chartRange === 'RESET' ? (resetIndex >= 0 ? 'Since latest meter reset' : 'All available readings') : chartRange === 'ALL' ? 'All readings' : `Last ${chartRange} month${chartRange === '1' ? '' : 's'}`}</span>
                    <ChevronDown size={15} className={`shrink-0 text-[#587064] transition ${chartRangeMenuOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                  </button>
                  {chartRangeMenuOpen && (
                    <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-full min-w-[230px] rounded-xl border border-[#d7eadc] bg-white p-3 text-left shadow-xl">
                      <div>
                        <p className="px-2 pb-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-[#668074]">Recommended</p>
                        <button type="button" onClick={() => { setChartRange('RESET'); setChartRangeMenuOpen(false) }} className={`w-full rounded-lg px-2.5 py-2 text-left text-xs font-bold transition ${chartRange === 'RESET' ? 'bg-[#2f8f5b] text-white' : 'text-[#466653] hover:bg-[#effaf2] hover:text-[#2f8f5b]'}`}>{resetIndex >= 0 ? 'Since latest meter reset' : 'All available readings'}</button>
                      </div>
                      <div className="mt-3">
                        <p className="px-2 pb-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-[#668074]">Recent</p>
                        <div className="grid gap-1 sm:grid-cols-2">
                          {['1', '2', '3', '6'].map((range) => <button key={range} type="button" onClick={() => { setChartRange(range); setChartRangeMenuOpen(false) }} className={`rounded-lg px-2.5 py-2 text-left text-xs font-bold transition ${chartRange === range ? 'bg-[#2f8f5b] text-white' : 'text-[#466653] hover:bg-[#effaf2] hover:text-[#2f8f5b]'}`}>Last {range} month{range === '1' ? '' : 's'}</button>)}
                        </div>
                      </div>
                      <div className="mt-3">
                        <p className="px-2 pb-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-[#668074]">Full history</p>
                        <button type="button" onClick={() => { setChartRange('ALL'); setChartRangeMenuOpen(false) }} className={`w-full rounded-lg px-2.5 py-2 text-left text-xs font-bold transition ${chartRange === 'ALL' ? 'bg-[#2f8f5b] text-white' : 'text-[#466653] hover:bg-[#effaf2] hover:text-[#2f8f5b]'}`}>All readings</button>
                      </div>
                    </div>
                  )}
                </span>
              </label>
            </div>

            {forecast && forecast.status !== 'READY' && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{forecast.reason}</p>}

            <div className="grid gap-6 xl:grid-cols-2">
              <ChartCard title="Monthly consumption" description="Actual and predicted consumption in cubic meters.">
                {consumptionData.length ? (
                  <ResponsiveContainer width="100%" height={320}>
                    <ComposedChart data={consumptionData} margin={{ top: 10, right: 12, left: 0, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#dceee2" />
                      <XAxis dataKey="label" angle={-25} textAnchor="end" height={70} tick={{ fontSize: 12 }} />
                      <YAxis unit=" m³" tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(value) => [`${Number(value).toFixed(3)} m³`]} />
                      <Legend />
                      <Bar dataKey="actual" name="Actual consumption" radius={[5, 5, 0, 0]} maxBarSize={64} animationBegin={0} animationDuration={1000} animationEasing="ease-out">
                        {consumptionData.map((row, index) => <Cell key={`actual-${row.label}-${index}`} fill={index % 2 === 0 ? '#2563eb' : '#2f8f5b'} />)}
                      </Bar>
                      {forecast?.status === 'READY' && <Bar dataKey="predicted" name="Predicted consumption" fill="#2f8f5b" radius={[5, 5, 0, 0]} maxBarSize={64} animationBegin={120} animationDuration={1000} animationEasing="ease-out" />}
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : <EmptyRow message="Meter-reading history is not available yet." />}
              </ChartCard>

              <ChartCard title="Meter-reading forecast" description="Recorded monthly meter readings and the predicted next reading.">
                {meterData.length ? (
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={meterData} margin={{ top: 10, right: 12, left: 0, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#dceee2" />
                      <XAxis dataKey="label" angle={-25} textAnchor="end" height={70} tick={{ fontSize: 12 }} />
                      <YAxis domain={meterDomain} tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(value) => [Number(value).toFixed(3)]} />
                      <Legend />
                      <Line type="monotone" dataKey="actual" name="Monthly meter reading" stroke="#2563eb" strokeWidth={3} dot={{ r: 4, fill: '#ffffff', strokeWidth: 3 }} />
                      {forecast?.status === 'READY' && <Line type="monotone" dataKey="predicted" name="Predicted reading" stroke="#34d399" strokeWidth={3} strokeDasharray="7 5" dot={{ r: 4, fill: '#ffffff', strokeWidth: 3 }} connectNulls />}
                    </LineChart>
                  </ResponsiveContainer>
                ) : <EmptyRow message="Meter-reading history is not available yet." />}
              </ChartCard>
            </div>

            {(selectedUnit?.history || []).some((reading) => reading.validationStatus === 'FLAGGED') && (
              <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Some readings require staff review and are excluded from the forecast.</p>
            )}

            <section className={`resident-insights rounded-2xl border p-4 ${allInsightsPositive ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/40'}`}>
              <div className="mb-4">
                <h3 className="flex items-center gap-2 font-black text-slate-950"><Lightbulb size={18} className="text-[var(--primary)]" />Prescriptive Insights</h3>
                <p className="mt-1 text-sm text-slate-500">Recommendations for Unit {selectedUnit?.unitNumber}, based on its water use and current billing status.</p>
              </div>
              {selectedRecommendations.length > 0 ? (
                <div className="space-y-3">
                  {selectedRecommendations.map((recommendation) => {
                    const positive = isPositiveInsight(recommendation)
                    return <article key={recommendation.id} className={`rounded-xl border p-4 ${positive ? 'border-emerald-200 bg-emerald-50 text-emerald-950' : 'border-amber-200 bg-amber-50 text-amber-950'}`}>
                      <p className={`text-xs font-bold uppercase tracking-wide ${positive ? 'text-emerald-700' : 'text-amber-700'}`}>{positive ? 'Everything looks normal' : 'Condition detected'}</p>
                      <p className={`mt-1 text-sm ${positive ? 'text-emerald-900' : 'text-amber-900'}`}>{recommendation.evidence?.condition}</p>
                      <p className={`mt-3 text-xs font-bold uppercase tracking-wide ${positive ? 'text-emerald-700' : 'text-amber-700'}`}>{positive ? 'Next step' : 'Recommended action'}</p>
                      <p className="mt-1 text-sm font-bold text-slate-950">{recommendation.message}</p>
                      <p className={`mt-2 text-xs ${positive ? 'text-emerald-800' : 'text-amber-800'}`}>{residentInsightEvidence(recommendation)}</p>
                    </article>
                  })}
                </div>
              ) : <EmptyRow message="No prescriptive insights are available for this unit yet." />}
            </section>
          </div>
        )}
      </Panel>

      <Panel title="Recent published SOAs" description="Open any statement to print it or submit a receipt image for OCR review.">
        <div className="space-y-4">
          {bills.slice(0, 4).map((bill) => (
            <article key={bill.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-lg font-black text-slate-950">Unit {bill.unitNumber}</p>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${bill.paymentStatus === 'PAID' ? 'bg-emerald-50 text-emerald-700' : bill.paymentStatus === 'PARTIAL' ? 'bg-sky-50 text-sky-700' : bill.paymentStatus === 'OVERDUE' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>{bill.paymentStatus}</span>
                </div>
                <p className="mt-1 text-sm text-slate-500">Due {String(bill.dueDate).slice(0, 10)} | Remaining PHP {Number(bill.remainingBalance || 0).toFixed(2)} | Advance PHP {Number(bill.advanceBalance || 0).toFixed(2)}</p>
              </div>
              <Link to={`/resident/bills/${bill.id}`} className="resident-soa-button resident-soa-button-green w-fit">Open SOA <span aria-hidden="true">→</span></Link>
            </article>
          ))}
        </div>
        {bills.length === 0 && <EmptyRow message="No published SOAs are visible yet. Admin needs to publish forwarded SOAs first." />}
      </Panel>

      <Panel title="Payment history shortcuts">
        <div className="flex flex-wrap gap-3">
          <Link to="/resident/bills" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold">View all SOAs</Link>
          <Link to="/resident/payments" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold">View payment history</Link>
        </div>
      </Panel>
    </DashboardLayout>
  )
}

function DashboardCard({ icon: Icon, label, value, accent }) {
  return <div className={`resident-summary-card resident-summary-${accent}`}><div><p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p><p className="mt-2 text-3xl font-black text-slate-950">{value}</p></div><div className="resident-card-icon"><Icon size={19} /></div></div>
}

function MetricCard({ label, value }) {
  return <div className="resident-metric-card"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-xl font-black text-slate-900">{value}</p></div>
}

function ChartCard({ title, description, children }) {
  return <div className="resident-chart-card min-w-0 rounded-2xl border p-4"><h3 className="font-black text-slate-900">{title}</h3><p className="mt-1 text-sm text-slate-500">{description}</p><div className="mt-4">{children}</div></div>
}

function isPositiveInsight(recommendation) {
  return recommendation.recommendationType === 'MONITOR_USAGE'
}

function residentInsightEvidence(recommendation) {
  const evidence = recommendation.evidence || {}
  if (recommendation.recommendationType === 'CHECK_HIGH_USAGE') return `Projected increase: ${Number(evidence.increasePercent || 0).toFixed(2)}% above the recent average.`
  if (recommendation.recommendationType === 'PAYMENT_REMINDER') return `Due ${String(evidence.dueDate || '').slice(0, 10)}; PHP ${Number(evidence.remainingBalance || 0).toFixed(2)} remains unpaid.`
  if (recommendation.recommendationType === 'RISING_CONSUMPTION') return `Recent readings: ${(evidence.values || []).map((value) => `${Number(value).toFixed(3)} m³`).join(', ')}.`
  if (recommendation.recommendationType === 'MONITOR_HIGH_USAGE') return `Projected use: ${Number(evidence.predictedConsumption || 0).toFixed(3)} m³.`
  if (recommendation.recommendationType === 'MONITOR_USAGE') return `Positive baseline readings: ${Number(evidence.positiveBaselineCount || 0)}; zero readings: ${Number(evidence.zeroReadingCount || 0)}; forecast: ${evidence.predictedConsumption === null || evidence.predictedConsumption === undefined ? 'not available' : `${Number(evidence.predictedConsumption).toFixed(3)} m³`}.`
  return 'Review this insight before the next meter reading.'
}
