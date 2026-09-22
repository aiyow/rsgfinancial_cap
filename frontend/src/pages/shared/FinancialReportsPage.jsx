import { useEffect, useMemo, useState } from 'react'
import { Download, FileText, Gauge, Printer, ReceiptText, WalletCards, Waves } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiFile, apiRequest } from '../../services/api'

const tabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'dues', label: 'Association Dues' },
  { key: 'water', label: 'Water Billing' },
  { key: 'receivables', label: 'Accounts Receivable' },
]

const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100'

function currentMonth() {
  return new Date().toISOString().slice(0, 7)
}

function money(value) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0))
}

function percentage(value) {
  return value === null || value === undefined ? '—' : `${Number(value).toFixed(1)}%`
}

function compactMoney(value) {
  const amount = Number(value || 0)
  if (Math.abs(amount) >= 1000000) return `₱${(amount / 1000000).toFixed(1)}M`
  if (Math.abs(amount) >= 1000) return `₱${(amount / 1000).toFixed(0)}k`
  return `₱${amount.toFixed(0)}`
}

function date(value) {
  if (!value) return '—'
  return new Date(`${String(value).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function reportQuery(filter) {
  const params = new URLSearchParams()
  if (filter.mode === 'month') params.set('month', filter.month)
  else {
    params.set('startDate', filter.startDate)
    params.set('endDate', filter.endDate)
  }
  return params.toString()
}

function Metric({ label, value, detail, icon: Icon, tone = 'green' }) {
  const tones = {
    green: 'border-l-emerald-600 bg-emerald-50/40',
    blue: 'border-l-blue-600 bg-blue-50/40',
    amber: 'border-l-amber-500 bg-amber-50/40',
    red: 'border-l-red-500 bg-red-50/40',
  }
  return <article className={`rounded-2xl border border-slate-200 border-l-4 p-5 shadow-sm ${tones[tone]}`}>
    <div className="flex items-start justify-between gap-3"><p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</p><span className="grid size-9 place-items-center rounded-lg bg-white text-emerald-700 shadow-sm"><Icon size={18} /></span></div>
    <p className="mt-3 text-2xl font-black tracking-tight text-slate-900">{value}</p>
    {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
  </article>
}

function Table({ children }) {
  return <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="financial-report-table w-full min-w-[720px] text-left text-sm">{children}</table></div>
}

function TableHead({ children }) {
  return <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{children}</tr></thead>
}

function HeaderCell({ children }) {
  return <th className="whitespace-nowrap px-4 py-3 font-black">{children}</th>
}

function DataCell({ children, moneyValue = false }) {
  return <td className={`px-4 py-3 ${moneyValue ? 'text-right font-semibold tabular-nums' : ''}`}>{children}</td>
}

function ChargeReport({ report, kind }) {
  const label = kind === 'water' ? 'Water' : 'Association dues'
  const billedRows = report?.billedRows || []
  const collectionRows = report?.collectionRows || []
  const totalBilled = billedRows.reduce((total, row) => total + Number(row.billed || 0), 0)
  const totalCollected = collectionRows.reduce((total, row) => total + Number(row.collected || 0), 0)
  return <div className="space-y-6">
    <div className="grid gap-4 sm:grid-cols-2">
      <Metric label={`${label} billed`} value={money(totalBilled)} detail="Billing periods starting in the selected filter" icon={FileText} tone="blue" />
      <Metric label={`${label} collected`} value={money(totalCollected)} detail="Approved payments verified in the selected filter" icon={WalletCards} />
    </div>
    <Panel title={`${label} billed`} description="Charges issued in live billing batches during the selected reporting period.">
      {billedRows.length ? <Table><TableHead><HeaderCell>Unit</HeaderCell><HeaderCell>Resident / payer</HeaderCell><HeaderCell>Billing period</HeaderCell><HeaderCell>Batch status</HeaderCell><HeaderCell>{label} billed</HeaderCell></TableHead><tbody className="divide-y divide-slate-100">{billedRows.map((row) => <tr key={row.billId}><DataCell>{row.unitNumber}</DataCell><DataCell>{row.payerName}</DataCell><DataCell>{date(row.periodStart)} – {date(row.periodEnd)}</DataCell><DataCell>{row.batchStatus}</DataCell><DataCell moneyValue>{money(row.billed)}</DataCell></tr>)}</tbody></Table> : <EmptyRow message={`No ${label.toLowerCase()} charges were billed in this period.`} />}
    </Panel>
    <Panel title={`${label} collections`} description="Approved payments received in the selected period, allocated proportionally across each SOA’s charge lines.">
      {collectionRows.length ? <Table><TableHead><HeaderCell>Payment date</HeaderCell><HeaderCell>Unit</HeaderCell><HeaderCell>Resident / payer</HeaderCell><HeaderCell>SOA period</HeaderCell><HeaderCell>Applied payment</HeaderCell><HeaderCell>{label} collected</HeaderCell></TableHead><tbody className="divide-y divide-slate-100">{collectionRows.map((row) => <tr key={`${row.paymentId}-${row.billId}`}><DataCell>{date(row.paymentDate)}</DataCell><DataCell>{row.unitNumber}</DataCell><DataCell>{row.payerName}</DataCell><DataCell>{date(row.periodStart)}</DataCell><DataCell moneyValue>{money(row.appliedAmount)}</DataCell><DataCell moneyValue>{money(row.collected)}</DataCell></tr>)}</tbody></Table> : <EmptyRow message={`No ${label.toLowerCase()} collections were received in this period.`} />}
    </Panel>
  </div>
}

function Overview({ overview }) {
  return <div className="space-y-6">
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <Metric label="Total monthly billing" value={money(overview.totalBilling)} detail="Water, dues, and applied late penalties" icon={FileText} tone="blue" />
      <Metric label="Total collections" value={money(overview.totalCollections)} detail="Approved payments by verified payment date" icon={WalletCards} />
      <Metric label="Collection efficiency" value={percentage(overview.collectionEfficiency)} detail={overview.collectionEfficiency === null ? 'No billing was issued in this period' : 'Approved collections ÷ billing issued for this period'} icon={Gauge} tone="amber" />
      <Metric label="Outstanding balance" value={money(overview.outstandingBalance)} detail="Open resident balances as of the filter end date" icon={ReceiptText} tone="red" />
      <Metric label="Association dues" value={`${money(overview.duesBilled)} billed`} detail={`${money(overview.duesCollected)} collected`} icon={FileText} tone="amber" />
      <Metric label="Water billing" value={`${money(overview.waterBilled)} billed`} detail={`${money(overview.waterCollected)} collected`} icon={Waves} tone="blue" />
      <Metric label="Unapplied credits" value={money(overview.unappliedCredits)} detail={`${money(overview.latePenalties)} late penalties billed`} icon={WalletCards} tone="amber" />
    </div>
    <FinancialCharts overview={overview} />
    <Panel title="How collections are reported" description="Collections use approved payments verified during the selected period. Payments applied to an SOA are split proportionally between its Water, Association Dues, and late-penalty amounts.">
      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3"><div className="rounded-xl bg-slate-50 p-4"><p className="font-bold">Water collected</p><p className="mt-1 text-lg font-black">{money(overview.waterCollected)}</p></div><div className="rounded-xl bg-slate-50 p-4"><p className="font-bold">Dues collected</p><p className="mt-1 text-lg font-black">{money(overview.duesCollected)}</p></div><div className="rounded-xl bg-slate-50 p-4"><p className="font-bold">Late penalties collected</p><p className="mt-1 text-lg font-black">{money(overview.latePenaltyCollected)}</p></div></div>
    </Panel>
  </div>
}

function FinancialCharts({ overview }) {
  const comparison = [
    { name: 'Billed', amount: Number(overview.totalBilling || 0), color: '#2563eb' },
    { name: 'Collected', amount: Number(overview.totalCollections || 0), color: '#15803d' },
    { name: 'Outstanding', amount: Number(overview.outstandingBalance || 0), color: '#dc2626' },
  ]
  const chargeMix = [
    { name: 'Association dues', value: Number(overview.duesBilled || 0), color: '#d97706' },
    { name: 'Water', value: Number(overview.waterBilled || 0), color: '#2563eb' },
    { name: 'Late penalties', value: Number(overview.latePenalties || 0), color: '#dc2626' },
  ].filter((item) => item.value > 0)
  const tooltipStyle = { borderRadius: 12, border: '1px solid #dbe5df', boxShadow: '0 10px 28px rgba(15, 44, 29, 0.12)', fontSize: 12 }

  return <div className="grid gap-6 xl:grid-cols-2">
    <Panel title="Billing, collections, and balance" description="A comparison of billed amounts, approved collections, and the remaining resident balance.">
      <div className="h-80"><ResponsiveContainer width="100%" height="100%"><BarChart data={comparison} margin={{ top: 12, right: 12, left: 4, bottom: 0 }}><CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="4 4" /><XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false} /><YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={compactMoney} tickLine={false} axisLine={false} width={58} /><Tooltip contentStyle={tooltipStyle} formatter={(value) => money(value)} cursor={{ fill: 'rgba(37, 99, 235, 0.06)' }} /><Bar dataKey="amount" name="Amount" radius={[7, 7, 0, 0]} maxBarSize={76}>{comparison.map((item) => <Cell key={item.name} fill={item.color} />)}</Bar></BarChart></ResponsiveContainer></div>
    </Panel>
    <Panel title="Billing charge mix" description="How the billing issued in the selected period is divided among charge types.">
      <div className="h-80">{chargeMix.length ? <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={chargeMix} dataKey="value" nameKey="name" innerRadius={64} outerRadius={96} paddingAngle={3} startAngle={90} endAngle={-270}>{chargeMix.map((item) => <Cell key={item.name} fill={item.color} stroke="#fff" strokeWidth={2} />)}</Pie><Tooltip contentStyle={tooltipStyle} formatter={(value) => money(value)} /><Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} /></PieChart></ResponsiveContainer> : <EmptyRow message="No billing charges were issued in this period." />}</div>
    </Panel>
  </div>
}

function Receivables({ rows }) {
  return <Panel title="Accounts Receivable" description="Outstanding resident balances as of the selected reporting end date.">
    {rows.length ? <Table><TableHead><HeaderCell>Unit</HeaderCell><HeaderCell>Resident / payer</HeaderCell><HeaderCell>Bill period</HeaderCell><HeaderCell>Due date</HeaderCell><HeaderCell>Billed</HeaderCell><HeaderCell>Paid</HeaderCell><HeaderCell>Balance</HeaderCell><HeaderCell>Status</HeaderCell></TableHead><tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={row.billId} className={row.paymentStatus === 'OVERDUE' ? 'bg-red-50/50' : ''}><DataCell>{row.unitNumber}</DataCell><DataCell>{row.payerName}</DataCell><DataCell>{date(row.periodStart)}</DataCell><DataCell>{date(row.dueDate)}</DataCell><DataCell moneyValue>{money(row.totalBilled)}</DataCell><DataCell moneyValue>{money(row.paidAmount)}</DataCell><DataCell moneyValue>{money(row.remainingBalance)}</DataCell><DataCell><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${row.paymentStatus === 'OVERDUE' ? 'bg-red-100 text-red-700' : row.paymentStatus === 'PARTIAL' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>{row.paymentStatus}</span></DataCell></tr>)}</tbody></Table> : <EmptyRow message="No outstanding resident balances exist as of this date." />}
  </Panel>
}

export default function FinancialReportsPage() {
  const { token } = useAuth()
  const [form, setForm] = useState({ mode: 'month', month: currentMonth(), startDate: '', endDate: '' })
  const [appliedFilter, setAppliedFilter] = useState({ mode: 'month', month: currentMonth(), startDate: '', endDate: '' })
  const [tab, setTab] = useState('overview')
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [requestVersion, setRequestVersion] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')

  const query = useMemo(() => reportQuery(appliedFilter), [appliedFilter])
  useEffect(() => {
    let active = true
    apiRequest(`/api/reports/financial?${query}`, { token })
      .then((data) => { if (active) setReport(data) })
      .catch((requestError) => { if (active) setError(requestError.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [query, requestVersion, token])

  function viewReport(event) {
    event.preventDefault()
    setLoading(true)
    setError('')
    setAppliedFilter({ ...form })
    setRequestVersion((version) => version + 1)
  }

  async function exportExcel() {
    setExporting(true)
    setError('')
    try {
      const blob = await apiFile(`/api/reports/financial/export?${query}&tab=${tab}`, { token })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `financial-report-${tab}-${report?.filters?.startDate || 'report'}.xlsx`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(link.href)
    } catch (requestError) { setError(requestError.message) } finally { setExporting(false) }
  }

  const activeLabel = tabs.find((item) => item.key === tab)?.label
  return <DashboardLayout title="Financial Reports" description="Monthly and date-range financial records for billing, collections, and receivables.">
    <div className="financial-report space-y-6">
      <div className="print-hidden"><h1 className="text-2xl font-black tracking-tight text-slate-900">Financial reports</h1><p className="mt-1 text-sm text-slate-500">View billing, payment collections, and outstanding resident balances.</p></div>
      <form onSubmit={viewReport} className="print-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end gap-4"><div className="flex gap-2"><button type="button" onClick={() => setForm((value) => ({ ...value, mode: 'month' }))} className={`rounded-lg px-3 py-2 text-sm font-bold ${form.mode === 'month' ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-700'}`}>Month</button><button type="button" onClick={() => setForm((value) => ({ ...value, mode: 'range' }))} className={`rounded-lg px-3 py-2 text-sm font-bold ${form.mode === 'range' ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-700'}`}>Date range</button></div>{form.mode === 'month' ? <label className="min-w-48 text-sm font-bold text-slate-700">Select month<input required type="month" value={form.month} onChange={(event) => setForm((value) => ({ ...value, month: event.target.value }))} className={inputClass} /></label> : <><label className="min-w-44 text-sm font-bold text-slate-700">Start date<input required type="date" value={form.startDate} onChange={(event) => setForm((value) => ({ ...value, startDate: event.target.value }))} className={inputClass} /></label><label className="min-w-44 text-sm font-bold text-slate-700">End date<input required type="date" value={form.endDate} onChange={(event) => setForm((value) => ({ ...value, endDate: event.target.value }))} className={inputClass} /></label></>}<button type="submit" className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-800">View report</button></div>
      </form>
      {error && <p className="print-hidden rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="print-hidden flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2" role="tablist" aria-label="Financial report tabs">{tabs.map((item) => <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} onClick={() => setTab(item.key)} className={`rounded-lg px-3 py-2 text-sm font-bold ${tab === item.key ? 'bg-emerald-700 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>{item.label}</button>)}</div><div className="flex gap-2"><button type="button" disabled={exporting || !report} onClick={exportExcel} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 disabled:opacity-50"><Download size={16} />{exporting ? 'Exporting…' : 'Export Excel'}</button><button type="button" disabled={!report} onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"><Printer size={16} />Print / Save PDF</button></div></div>
      {report && <div className="print:block"><div className="mb-5 hidden print:block"><h1 className="text-2xl font-black">{activeLabel}</h1><p>Reporting period: {report.filters.label}</p></div>{loading ? <Panel title="Loading report"><EmptyRow message="Loading financial records..." /></Panel> : <>{tab === 'overview' && <Overview overview={report.overview} />}{tab === 'dues' && <ChargeReport report={report.dues} kind="dues" />}{tab === 'water' && <ChargeReport report={report.water} kind="water" />}{tab === 'receivables' && <Receivables rows={report.receivables} />}</>}</div>}
      {!report && loading && <Panel title="Loading report"><EmptyRow message="Loading financial records..." /></Panel>}
    </div>
  </DashboardLayout>
}
