import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, Building2, CircleDollarSign, Droplets, FileText, Gauge, ReceiptText, RefreshCw, TrendingUp, WalletCards } from 'lucide-react'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

const paymentStatusColors = {
  Paid: '#2f8f5b',
  'Partially paid': '#e3a326',
  Overdue: '#d85c4a',
  Unpaid: '#64748b',
}

function money(value) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(Number(value || 0))
}

function month(value) {
  return value ? new Date(`${String(value).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'No billing yet'
}

function ratio(value, total) {
  const denominator = Number(total || 0)
  if (denominator <= 0) return null
  return Number(((Number(value || 0) / denominator) * 100).toFixed(1))
}

function percent(value) {
  return value === null || value === undefined ? '—' : `${Number(value).toFixed(1)}%`
}

function connectForecastLine(rows) {
  const result = rows.map((row) => ({ ...row, forecastConsumption: row.projectedConsumption }))
  const firstForecastIndex = result.findIndex((row) => row.projectedConsumption !== null)
  if (firstForecastIndex === -1) return result

  for (let index = firstForecastIndex; index >= 0; index -= 1) {
    if (result[index].actualConsumption !== null) {
      result[index].forecastConsumption = result[index].actualConsumption
      break
    }
  }
  return result
}

function Metric({ label, value, detail, icon: Icon, tone = 'green', accent }) {
  const tones = { green: 'border-l-[var(--primary)] bg-emerald-50/40', amber: 'border-l-amber-500 bg-amber-50/40', red: 'border-l-red-500 bg-red-50/40', blue: 'border-l-sky-600 bg-sky-50/40' }
  return <article className={`min-w-0 rounded-2xl border border-[var(--border)] border-l-[3px] p-5 shadow-sm ${tones[tone]} ${accent ? `collector-metric collector-metric-${accent}` : ''}`}>
    <div className="flex items-start justify-between gap-3"><p className="text-[11px] font-black uppercase tracking-[0.12em] text-[var(--muted)]">{label}</p><span className="grid size-9 place-items-center rounded-lg bg-white text-[var(--primary)] shadow-sm"><Icon size={18} /></span></div>
    <p className="mt-4 truncate text-2xl font-black tracking-tight text-[var(--ink)]">{value}</p>
    <p className="mt-1 min-h-5 text-xs text-[var(--muted)]">{detail}</p>
  </article>
}

function ChartPanel({ title, description, variant, children }) {
  return <section className={`collector-chart-panel overflow-hidden rounded-2xl border border-[var(--border)] bg-gradient-to-b from-white to-slate-50/60 p-5 shadow-sm sm:p-6 ${variant === 'trend' ? 'collector-trend-chart' : ''}`}><p className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--primary)]">Live insight</p><h2 className="mt-1 text-base font-black text-[var(--ink)]">{title}</h2><p className="mt-1 text-sm text-[var(--muted)]">{description}</p><div className="mt-5 h-72">{children}</div></section>
}

function ProgressRow({ label, value, amount, tone = 'emerald' }) {
  const colors = { emerald: 'bg-emerald-600', amber: 'bg-amber-500', red: 'bg-rose-600', blue: 'bg-sky-600' }
  const width = Math.min(Math.max(Number(value || 0), 0), 100)
  return <div><div className="flex items-baseline justify-between gap-3 text-sm"><span className="font-bold text-[var(--ink)]">{label}</span><span className="text-right text-xs font-semibold text-[var(--muted)]">{amount} · {percent(value)}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${colors[tone]}`} style={{ width: `${width}%` }} /></div></div>
}

function QuickStat({ label, value, detail, tone = 'slate' }) {
  const tones = { slate: 'bg-slate-50 text-slate-800', emerald: 'bg-emerald-50 text-emerald-800', amber: 'bg-amber-50 text-amber-800', red: 'bg-rose-50 text-rose-800' }
  return <div className={`rounded-xl p-3 ${tones[tone]}`}><p className="text-[10px] font-black uppercase tracking-wide opacity-70">{label}</p><p className="mt-1 text-xl font-black">{value}</p><p className="text-xs opacity-75">{detail}</p></div>
}

const chartTooltipStyle = { borderRadius: 12, border: '1px solid #dbe5df', boxShadow: '0 10px 28px rgba(15, 44, 29, 0.12)', fontSize: 12 }

function BillingTrendChart({ monthly }) {
  return <ChartPanel title="Billing and collection trend" description="Billed amounts compared with payments applied across the latest six billing periods." variant="trend">
    {monthly.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={monthly} margin={{ top: 8, right: 8, left: -10, bottom: 0 }} barGap={7}><defs><linearGradient id="dashboardBilled" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#3b82f6" /><stop offset="100%" stopColor="#1d4ed8" /></linearGradient><linearGradient id="dashboardCollected" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#4ade80" /><stop offset="100%" stopColor="#15803d" /></linearGradient></defs><CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="4 4" /><XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false} /><YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} tickFormatter={(value) => `₱${Math.round(value / 1000)}k`} /><Tooltip contentStyle={chartTooltipStyle} cursor={{ fill: 'rgba(37, 99, 235, 0.06)' }} formatter={(value) => money(value)} /><Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} /><Bar dataKey="billed" name="Billed" fill="url(#dashboardBilled)" radius={[6, 6, 0, 0]} maxBarSize={36} animationBegin={0} animationDuration={900} animationEasing="ease-out" /><Bar dataKey="collected" name="Collected" fill="url(#dashboardCollected)" radius={[6, 6, 0, 0]} maxBarSize={36} animationBegin={120} animationDuration={900} animationEasing="ease-out" /></BarChart></ResponsiveContainer> : <EmptyRow message="No billing periods are available yet." />}
  </ChartPanel>
}

function BillStatusChart({ billStatus }) {
  return <ChartPanel title="Statement payment status" description="How generated statements are currently paid, partly paid, or overdue.">
    {billStatus.length ? <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={billStatus} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90} paddingAngle={4} startAngle={90} endAngle={-270} isAnimationActive animationBegin={0} animationDuration={1000} animationEasing="ease-out">{billStatus.map((item) => <Cell key={item.name} fill={paymentStatusColors[item.name] || '#64748b'} stroke="#fff" strokeWidth={2} />)}</Pie><Tooltip contentStyle={chartTooltipStyle} formatter={(value) => Number(value)} /><Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} /></PieChart></ResponsiveContainer> : <EmptyRow message="No statements have been generated yet." />}
  </ChartPanel>
}

function WaterTrendChart({ waterTrend }) {
  return <ChartPanel title="Historical vs projected water consumption" description="Validated use compared with the next available water-use forecast.">
    {waterTrend.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={waterTrend} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}><defs><linearGradient id="dashboardActualWater" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#60a5fa" stopOpacity={0.34} /><stop offset="100%" stopColor="#60a5fa" stopOpacity={0.02} /></linearGradient><linearGradient id="dashboardForecastWater" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#a78bfa" stopOpacity={0.28} /><stop offset="100%" stopColor="#a78bfa" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="4 4" /><XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false} /><YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} unit=" m³" /><Tooltip contentStyle={chartTooltipStyle} formatter={(value, name) => [`${Number(value).toFixed(2)} m³`, name === 'Projected forecast' ? 'Projected forecast' : 'Historical actual']} /><Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} /><Area type="monotone" dataKey="actualConsumption" name="Historical actual" stroke="#2563eb" fill="url(#dashboardActualWater)" strokeWidth={3} dot={{ r: 3, fill: '#2563eb', strokeWidth: 0 }} activeDot={{ r: 6, fill: '#2563eb' }} isAnimationActive animationBegin={0} animationDuration={1000} animationEasing="ease-out" /><Area type="monotone" dataKey="forecastConsumption" name="Projected forecast" stroke="#7c3aed" fill="url(#dashboardForecastWater)" strokeWidth={3} strokeDasharray="7 5" dot={{ r: 3, fill: '#7c3aed', strokeWidth: 0 }} activeDot={{ r: 6, fill: '#7c3aed' }} connectNulls isAnimationActive animationBegin={140} animationDuration={1000} animationEasing="ease-out" /></AreaChart></ResponsiveContainer> : <EmptyRow message="No water analytics data is available yet." />}
  </ChartPanel>
}

export default function OperationalDashboard({ role }) {
  const { token } = useAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    let active = true
    Promise.all([
      apiRequest('/api/dashboard/overview', { token }),
      apiRequest('/api/analytics/overview', { token }),
    ])
      .then(([dashboard, analytics]) => { if (active) { setData({ ...dashboard, analytics }); setError('') } })
      .catch((requestError) => { if (active) setError(requestError.message) })
      .finally(() => { if (active) setRefreshing(false) })
    return () => { active = false }
  }, [refreshKey, token])

  const metrics = data?.metrics || {}
  const monthly = (data?.monthly || []).map((row) => ({ ...row, label: month(row.month), billed: Number(row.billed), collected: Number(row.collected), consumption: Number(row.consumption) }))
  const billStatus = (data?.billStatus || []).map((row) => ({ ...row, value: Number(row.value) }))
  const waterTrend = connectForecastLine((data?.analytics?.chartSeries || []).map((row) => ({
    label: month(row.month),
    actualConsumption: row.actualConsumption === null ? null : Number(row.actualConsumption),
    projectedConsumption: row.projectedConsumption === null ? null : Number(row.projectedConsumption),
    actualWaterBill: row.actualWaterBill === null ? null : Number(row.actualWaterBill),
    projectedWaterBill: row.projectedWaterBill === null ? null : Number(row.projectedWaterBill),
  })))
  const currentBilled = Number(metrics.currentBilled || 0)
  const currentCollected = Number(metrics.currentCollected || 0)
  const collectionRate = ratio(currentCollected, currentBilled)
  const collectionGap = Math.max(currentBilled - currentCollected, 0)
  const latestActualWater = [...waterTrend].reverse().find((row) => row.actualConsumption !== null)
  const latestWaterForecast = [...waterTrend].reverse().find((row) => row.projectedConsumption !== null)
  const roleIsAdmin = role === 'ADMIN'
  const actions = roleIsAdmin
    ? [
      { title: 'Payment verification', value: metrics.pendingPayments || 0, description: 'payment proof(s) waiting for review', to: '/admin/payments', icon: ReceiptText },
      { title: 'Overdue SOAs', value: metrics.overdueBills || 0, description: 'account(s) still have a balance', to: '/admin/soa', icon: AlertTriangle },
      { title: 'Water recommendations', value: metrics.openRecommendations || 0, description: `${metrics.highPriorityRecommendations || 0} high priority`, to: '/admin/analytics', icon: Gauge },
    ]
    : [
      { title: 'Latest billing', value: metrics.latestPeriodStatus || 'Not started', description: metrics.latestPeriodStart ? `${month(metrics.latestPeriodStart)} billing period` : 'Create the first billing period', to: '/collector/billing', icon: FileText },
      { title: 'Overdue SOAs', value: metrics.overdueBills || 0, description: 'account(s) still have a balance', to: '/collector/bills', icon: AlertTriangle },
      { title: 'Water recommendations', value: metrics.openRecommendations || 0, description: `${metrics.highPriorityRecommendations || 0} high priority`, to: '/collector/analytics', icon: Gauge },
    ]

  return <DashboardLayout title={roleIsAdmin ? 'Executive dashboard' : 'Collector dashboard'} description="Live operational overview of billing, payments, occupancy, and water use.">
    {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {!data ? <Panel title="Loading dashboard"><EmptyRow message="Loading your latest billing summary..." /></Panel> : <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h1 className="text-2xl font-black tracking-tight text-[var(--ink)]">{roleIsAdmin ? 'Executive dashboard' : 'Billing operations dashboard'}</h1><p className="mt-1 text-sm text-[var(--muted)]">Current billing period: <strong className="text-[var(--ink)]">{month(metrics.latestPeriodStart)}</strong>{metrics.latestPeriodStatus ? ` (${metrics.latestPeriodStatus.toLowerCase()})` : ''}</p></div><button type="button" onClick={() => { setRefreshing(true); setRefreshKey((value) => value + 1) }} disabled={refreshing} className="inline-flex w-fit items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm font-bold text-[var(--ink)] shadow-sm transition hover:bg-[var(--app-bg)] disabled:opacity-50"><RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />{refreshing ? 'Refreshing…' : 'Refresh overview'}</button></div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,1fr)]">
        <BillingTrendChart monthly={monthly} />
        <BillStatusChart billStatus={billStatus} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Current billing" value={money(currentBilled)} detail={`${metrics.currentBills || 0} statement(s) issued`} icon={FileText} accent="blue" />
        <Metric label="Collected so far" value={money(currentCollected)} detail="payments applied to current billing" icon={WalletCards} tone="blue" accent="green" />
        <Metric label="Collection efficiency" value={percent(collectionRate)} detail={collectionRate === null ? 'No current billing to measure' : `${money(collectionGap)} still to collect`} icon={TrendingUp} tone={collectionRate !== null && collectionRate < 70 ? 'amber' : 'green'} accent="blue" />
        <Metric label="Overdue balance" value={money(metrics.overdueAmount)} detail={`${metrics.overdueBills || 0} overdue statement(s)`} icon={CircleDollarSign} tone={metrics.overdueBills ? 'red' : 'green'} accent="red" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,1fr)]">
        <Panel title="Financial health" description="Track the current billing period at a glance.">
          <div className="space-y-5"><ProgressRow label="Collected from current billing" value={collectionRate || 0} amount={`${money(currentCollected)} of ${money(currentBilled)}`} tone={collectionRate !== null && collectionRate < 70 ? 'amber' : 'emerald'} /><div className="grid gap-3 sm:grid-cols-3"><QuickStat label="Fully paid" value={metrics.currentPaidBills || 0} detail="statements cleared" tone="emerald" /><QuickStat label="Partly paid" value={metrics.currentPartialBills || 0} detail="need a balance payment" tone="amber" /><QuickStat label="Not yet paid" value={metrics.currentUnpaidBills || 0} detail="no payment applied" tone="red" /></div></div>
        </Panel>
        <Panel title="Water outlook" description="Latest validated use and the next available forecast.">
          <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1"><div className="rounded-xl bg-sky-50 p-4"><div className="flex items-center gap-2 text-sky-800"><Droplets size={17} /><p className="text-xs font-black uppercase tracking-wide">Latest actual use</p></div><p className="mt-2 text-2xl font-black text-slate-900">{latestActualWater ? `${latestActualWater.actualConsumption.toFixed(1)} m³` : '—'}</p><p className="mt-1 text-xs text-slate-600">{latestActualWater ? `${latestActualWater.label} · ${money(latestActualWater.actualWaterBill)}` : 'No validated reading yet'}</p></div><div className="rounded-xl bg-violet-50 p-4"><div className="flex items-center gap-2 text-violet-800"><TrendingUp size={17} /><p className="text-xs font-black uppercase tracking-wide">Next forecast</p></div><p className="mt-2 text-2xl font-black text-slate-900">{latestWaterForecast ? `${latestWaterForecast.projectedConsumption.toFixed(1)} m³` : '—'}</p><p className="mt-1 text-xs text-slate-600">{latestWaterForecast ? `${latestWaterForecast.label} · est. ${money(latestWaterForecast.projectedWaterBill)}` : 'No ready forecast yet'}</p></div></div><div className="rounded-xl border border-[var(--border)] bg-[var(--app-bg)] p-3"><p className="text-sm font-bold text-[var(--ink)]">Forecast coverage</p><p className="mt-1 text-xs text-[var(--muted)]">{data.analytics?.latestForecast?.ready || 0} of {data.analytics?.latestForecast?.total || 0} homes have a ready forecast; {data.analytics?.latestForecast?.excluded || 0} need more valid meter history.</p></div><Link to={roleIsAdmin ? '/admin/analytics' : '/collector/analytics'} className="inline-flex items-center gap-2 text-sm font-bold text-[var(--primary)] hover:underline">Open Water Usage <span aria-hidden="true">→</span></Link></div>
        </Panel>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="Homes occupied" value={`${metrics.occupiedUnits || 0} / ${metrics.totalUnits || 0}`} detail={`${metrics.vacantUnits || 0} vacant homes`} icon={Building2} tone="blue" accent="blue" />
        <Metric label="Payment reviews" value={metrics.pendingPayments || 0} detail={roleIsAdmin ? 'proofs waiting for verification' : 'waiting for Admin verification'} icon={ReceiptText} tone={metrics.pendingPayments ? 'amber' : 'green'} accent="green" />
        <Metric label="High-priority water alerts" value={metrics.highPriorityRecommendations || 0} detail={`${metrics.openRecommendations || 0} recommendations open`} icon={Gauge} tone={metrics.highPriorityRecommendations ? 'red' : 'green'} accent="red" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,1fr)]">
        <WaterTrendChart waterTrend={waterTrend} />
        <Panel title="Needs attention" description="Open the right page to continue the work.">
          <div className="space-y-3">{actions.map((action) => { const Icon = action.icon; return <Link key={action.title} to={action.to} className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3 transition hover:border-[var(--primary)] hover:bg-[var(--app-bg)]"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--active-bg)] text-[var(--primary)]"><Icon size={18} /></span><span className="min-w-0 flex-1"><span className="block text-sm font-bold text-[var(--ink)]">{action.title}</span><span className="block text-xs text-[var(--muted)]">{action.description}</span></span><strong className="text-lg font-black text-[var(--ink)]">{action.value}</strong></Link> })}</div>
        </Panel>
      </div>
    </>}
  </DashboardLayout>
}
