import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, Building2, CircleDollarSign, FileText, Gauge, ReceiptText, UsersRound, WalletCards } from 'lucide-react'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

const statusColors = ['#2f8f5b', '#6c9f7c', '#e3a326', '#d85c4a']

function money(value) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(Number(value || 0))
}

function month(value) {
  return value ? new Date(`${String(value).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'No billing yet'
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

function Metric({ label, value, detail, icon: Icon, tone = 'green' }) {
  const tones = { green: 'border-l-[var(--primary)] bg-emerald-50/40', amber: 'border-l-amber-500 bg-amber-50/40', red: 'border-l-red-500 bg-red-50/40', blue: 'border-l-sky-600 bg-sky-50/40' }
  return <article className={`min-w-0 rounded-2xl border border-[var(--border)] border-l-[3px] p-5 shadow-sm ${tones[tone]}`}>
    <div className="flex items-start justify-between gap-3"><p className="text-[11px] font-black uppercase tracking-[0.12em] text-[var(--muted)]">{label}</p><span className="grid size-9 place-items-center rounded-lg bg-white text-[var(--primary)] shadow-sm"><Icon size={18} /></span></div>
    <p className="mt-4 truncate text-2xl font-black tracking-tight text-[var(--ink)]">{value}</p>
    <p className="mt-1 min-h-5 text-xs text-[var(--muted)]">{detail}</p>
  </article>
}

function ChartPanel({ title, description, children }) {
  return <section className="rounded-2xl border border-[var(--border)] bg-white p-5 shadow-sm sm:p-6"><h2 className="text-base font-black text-[var(--ink)]">{title}</h2><p className="mt-1 text-sm text-[var(--muted)]">{description}</p><div className="mt-5 h-72">{children}</div></section>
}

export default function OperationalDashboard({ role }) {
  const { token } = useAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([
      apiRequest('/api/dashboard/overview', { token }),
      apiRequest('/api/analytics/overview', { token }),
    ])
      .then(([dashboard, analytics]) => { if (active) setData({ ...dashboard, analytics }) })
      .catch((requestError) => { if (active) setError(requestError.message) })
    return () => { active = false }
  }, [token])

  const metrics = data?.metrics || {}
  const monthly = (data?.monthly || []).map((row) => ({ ...row, label: month(row.month), billed: Number(row.billed), collected: Number(row.collected), consumption: Number(row.consumption) }))
  const billStatus = (data?.billStatus || []).map((row) => ({ ...row, value: Number(row.value) }))
  const waterTrend = connectForecastLine((data?.analytics?.chartSeries || []).map((row) => ({
    label: month(row.month),
    actualConsumption: row.actualConsumption === null ? null : Number(row.actualConsumption),
    projectedConsumption: row.projectedConsumption === null ? null : Number(row.projectedConsumption),
  })))
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
      <div><h1 className="text-2xl font-black tracking-tight text-[var(--ink)]">{roleIsAdmin ? 'Executive dashboard' : 'Billing operations dashboard'}</h1><p className="mt-1 text-sm text-[var(--muted)]">Current billing period: <strong className="text-[var(--ink)]">{month(metrics.latestPeriodStart)}</strong>{metrics.latestPeriodStatus ? ` (${metrics.latestPeriodStatus.toLowerCase()})` : ''}</p></div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Current billed" value={money(metrics.currentBilled)} detail="latest billing period" icon={FileText} />
        <Metric label="Current collected" value={money(metrics.currentCollected)} detail="payments applied to latest period" icon={WalletCards} tone="blue" />
        <Metric label="Open balance" value={money(metrics.outstandingBalance)} detail={`${metrics.overdueBills || 0} overdue SOA(s)`} icon={CircleDollarSign} tone={metrics.overdueBills ? 'red' : 'green'} />
        <Metric label="Occupied units" value={metrics.occupiedUnits || 0} detail={`${metrics.vacantUnits || 0} vacant units`} icon={Building2} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,1fr)]">
        <ChartPanel title="Billing and collection trend" description="Billed amounts and approved payments for the latest six billing periods.">
          {monthly.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}><XAxis dataKey="label" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} tickFormatter={(value) => `P${Math.round(value / 1000)}k`} /><Tooltip formatter={(value) => money(value)} /><Legend /><Bar dataKey="billed" name="Billed" fill="#2f8f5b" radius={[5, 5, 0, 0]} /><Bar dataKey="collected" name="Collected" fill="#8dcaa4" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer> : <EmptyRow message="No billing periods are available yet." />}
        </ChartPanel>
        <ChartPanel title="SOA status" description="Current payment status across all generated SOAs.">
          {billStatus.length ? <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={billStatus} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={3}>{billStatus.map((item, index) => <Cell key={item.name} fill={statusColors[index % statusColors.length]} />)}</Pie><Tooltip formatter={(value) => Number(value)} /><Legend /></PieChart></ResponsiveContainer> : <EmptyRow message="No SOAs have been generated yet." />}
        </ChartPanel>
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,1fr)]">
        <ChartPanel title="Historical vs projected water consumption" description="The same validated actual and forecast data shown in Water Analytics.">
          {waterTrend.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={waterTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}><XAxis dataKey="label" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} unit=" m3" /><Tooltip formatter={(value, name) => [`${Number(value).toFixed(2)} m3`, name === 'Projected forecast' ? 'Projected forecast' : 'Historical actual']} /><Legend /><Line type="monotone" dataKey="actualConsumption" name="Historical actual" stroke="#2563eb" strokeWidth={3} dot={{ r: 4, fill: '#ffffff', strokeWidth: 3 }} /><Line type="monotone" dataKey="forecastConsumption" name="Projected forecast" stroke="#7c3aed" strokeWidth={3} strokeDasharray="7 5" dot={{ r: 4, fill: '#ffffff', strokeWidth: 3 }} connectNulls /></LineChart></ResponsiveContainer> : <EmptyRow message="No water analytics data is available yet." />}
        </ChartPanel>
        <Panel title="Needs attention" description="Open the right page to continue the work.">
          <div className="space-y-3">{actions.map((action) => { const Icon = action.icon; return <Link key={action.title} to={action.to} className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3 transition hover:border-[var(--primary)] hover:bg-[var(--app-bg)]"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--active-bg)] text-[var(--primary)]"><Icon size={18} /></span><span className="min-w-0 flex-1"><span className="block text-sm font-bold text-[var(--ink)]">{action.title}</span><span className="block text-xs text-[var(--muted)]">{action.description}</span></span><strong className="text-lg font-black text-[var(--ink)]">{action.value}</strong></Link> })}</div>
        </Panel>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Metric label="Vacant units" value={metrics.vacantUnits || 0} detail="available occupancy records" icon={UsersRound} tone="blue" />
        <Metric label="Pending payments" value={metrics.pendingPayments || 0} detail={roleIsAdmin ? 'awaiting Admin verification' : 'currently awaiting Admin verification'} icon={ReceiptText} tone={metrics.pendingPayments ? 'amber' : 'green'} />
        <Metric label="High priority water alerts" value={metrics.highPriorityRecommendations || 0} detail="meter or high-usage reviews" icon={Gauge} tone={metrics.highPriorityRecommendations ? 'red' : 'green'} />
      </div>
    </>}
  </DashboardLayout>
}
