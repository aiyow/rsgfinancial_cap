import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
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

function paddedDomain(values) {
  const numericValues = values.filter((value) => Number.isFinite(value))
  if (!numericValues.length) return ['auto', 'auto']
  const min = Math.min(...numericValues)
  const max = Math.max(...numericValues)
  const spread = Math.max(max - min, 1)
  const padding = spread * 0.2
  return [Math.max(0, Math.floor((min - padding) * 1000) / 1000), Math.ceil((max + padding) * 1000) / 1000]
}

export default function ResidentDashboard() {
  const { token } = useAuth()
  const [bills, setBills] = useState([])
  const [payments, setPayments] = useState([])
  const [analyticsUnits, setAnalyticsUnits] = useState([])
  const [recommendations, setRecommendations] = useState([])
  const [selectedUnitId, setSelectedUnitId] = useState('')
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
  const validHistory = selectedUnit?.history.filter((reading) => reading.validationStatus === 'VALID') || []
  const latestReading = validHistory.at(-1)
  const recentAverage = validHistory.length
    ? validHistory.slice(-5).reduce((sum, reading) => sum + number(reading.consumption), 0) / Math.min(5, validHistory.length)
    : null
  const forecast = selectedUnit?.forecast
  const hasImportedAnalytics = analyticsUnits.some((unit) => unit.history.length > 0)

  const consumptionData = useMemo(() => {
    const rows = (selectedUnit?.history || []).map((reading) => ({
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
  }, [forecast, selectedUnit])

  const meterData = useMemo(() => (selectedUnit?.history || []).map((reading) => ({
    label: monthLabel(reading.periodStart),
    previous: number(reading.previousReading),
    present: number(reading.currentReading),
  })), [selectedUnit])
  const meterDomain = useMemo(() => paddedDomain(meterData.flatMap((row) => [row.previous, row.present])), [meterData])

  return (
    <DashboardLayout title="Resident dashboard" description="View published SOAs, payment status, historical water use, and next-month estimates.">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="grid gap-4 md:grid-cols-3">
        <DashboardCard label="Published SOAs" value={summary.publishedSoas} />
        <DashboardCard label="Need payment" value={summary.unpaid} />
        <DashboardCard label="Pending payment reviews" value={summary.pendingPayments} />
      </div>

      {recommendations.length > 0 && (
        <Panel title="Water-use notice" description="This is an early estimate, not an additional bill. Your building team has reviewed this notice before sharing it.">
          <div className="space-y-3">
            {recommendations.map((recommendation) => (
              <article key={recommendation.id} className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="font-black text-slate-950">Unit {recommendation.unitNumber}</p>
                <p className="mt-1 text-sm text-amber-900">{recommendation.message}</p>
                {recommendation.evidence?.increasePercent !== undefined && <p className="mt-2 text-xs text-amber-800">Projected increase: {Number(recommendation.evidence.increasePercent).toFixed(2)}% above the recent average.</p>}
              </article>
            ))}
          </div>
        </Panel>
      )}

      <Panel title="Water consumption analytics" description="Forecasts are estimates based on five consecutive valid monthly readings and do not replace your actual bill.">
        {analyticsUnits.length === 0 || !hasImportedAnalytics ? <EmptyRow message="No analytics data yet. Import historical readings first." /> : (
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

            {forecast && forecast.status !== 'READY' && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{forecast.reason}</p>}

            <div className="grid gap-6 xl:grid-cols-2">
              <ChartCard title="Monthly consumption" description="Actual and predicted consumption in cubic meters.">
                {consumptionData.length ? (
                  <ResponsiveContainer width="100%" height={320}>
                    <ComposedChart data={consumptionData} margin={{ top: 10, right: 12, left: 0, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="label" angle={-25} textAnchor="end" height={70} tick={{ fontSize: 12 }} />
                      <YAxis unit=" m³" tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(value) => [`${Number(value).toFixed(3)} m³`]} />
                      <Legend />
                      <Bar dataKey="actual" name="Actual consumption" fill="#4f46e5" radius={[5, 5, 0, 0]} maxBarSize={64} />
                      {forecast?.status === 'READY' && <Bar dataKey="predicted" name="Predicted consumption" fill="#f59e0b" radius={[5, 5, 0, 0]} maxBarSize={64} />}
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : <EmptyRow message="Meter-reading history is not available yet." />}
              </ChartCard>

              <ChartCard title="Meter-reading history" description="Cumulative meter values recorded for each billing month.">
                {meterData.length ? (
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={meterData} margin={{ top: 10, right: 12, left: 0, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="label" angle={-25} textAnchor="end" height={70} tick={{ fontSize: 12 }} />
                      <YAxis domain={meterDomain} tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(value) => [Number(value).toFixed(3)]} />
                      <Legend />
                      <Line dataKey="previous" name="Previous reading" stroke="#64748b" strokeWidth={2} dot={{ r: 3 }} />
                      <Line dataKey="present" name="Present reading" stroke="#0f766e" strokeWidth={3} dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : <EmptyRow message="Meter-reading history is not available yet." />}
              </ChartCard>
            </div>

            {(selectedUnit?.history || []).some((reading) => reading.validationStatus === 'FLAGGED') && (
              <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Some readings require staff review and are excluded from the forecast.</p>
            )}
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
              <Link to={`/resident/bills/${bill.id}`} className="w-fit rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white">Open SOA</Link>
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

function DashboardCard({ label, value }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">{label}</p><p className="mt-3 text-3xl font-black text-slate-950">{value}</p></div>
}

function MetricCard({ label, value }) {
  return <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-2 text-xl font-black text-slate-900">{value}</p></div>
}

function ChartCard({ title, description, children }) {
  return <div className="min-w-0 rounded-2xl border border-slate-200 p-4"><h3 className="font-black text-slate-900">{title}</h3><p className="mt-1 text-sm text-slate-500">{description}</p><div className="mt-4">{children}</div></div>
}
