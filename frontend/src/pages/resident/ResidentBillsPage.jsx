import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

function money(value) {
  return `PHP ${new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0))}`
}

function dateLabel(value) {
  const [year, month, day] = String(value || '').slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return '—'
  const label = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day)))
  return label.replace(/^([A-Za-z]{3})/, '$1.')
}

export default function ResidentBillsPage() {
  const { token } = useAuth()
  const [bills, setBills] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    apiRequest('/api/bills', { token })
      .then((data) => { if (active) setBills(data.bills) })
      .catch((requestError) => { if (active) setError(requestError.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token])

  return (
    <DashboardLayout title="My Statements of Account" description="Review your published SOAs below, then open one when you need to submit payment proof or print it.">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <Panel title="Published SOAs" description="See each statement's key details here, then open it for the full SOA, payment QR, and receipt upload.">
        {loading ? <BillsSkeleton /> : <div className="space-y-4">
          {bills.map((bill) => (
            <article key={bill.id} className="overflow-hidden rounded-2xl border border-[#d8e8dc] bg-white shadow-sm">
              <div className="flex flex-col gap-4 border-b border-[#d9e7dd] bg-emerald-50/60 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--primary)]">Statement of account</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2"><h2 className="text-xl font-black text-slate-950">Unit {bill.unitNumber}</h2><span className={`rounded-full px-2.5 py-1 text-xs font-black ${statusStyle(bill.paymentStatus)}`}>{bill.paymentStatus}</span></div>
                </div>
                <div className="flex flex-wrap items-center gap-3"><div className="text-left sm:text-right"><p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Remaining balance</p><p className="mt-1 text-xl font-black text-slate-950">{money(bill.remainingBalance)}</p></div><Link to={`/resident/bills/${bill.id}`} className="resident-soa-button resident-soa-button-green">Open SOA</Link></div>
              </div>
              <div className="grid gap-3 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4 sm:p-5">
                <BillDetail label="Billing period" value={`${dateLabel(bill.periodStart)} – ${dateLabel(bill.periodEnd)}`} />
                <BillDetail label="Due date" value={dateLabel(bill.dueDate)} emphasis={bill.paymentStatus === 'OVERDUE'} />
                <BillDetail label="Total amount" value={money(bill.totalAmount)} />
                <BillDetail label="Approved payments" value={money(bill.approvedAmount)} />
              </div>
              {bill.hasPendingPayment && <p className="mx-4 mb-4 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 sm:mx-5 sm:mb-5">Your payment proof is awaiting Admin review.</p>}
            </article>
          ))}
        </div>}
        {!loading && bills.length === 0 && <EmptyRow message="No published SOAs are available for your assigned units yet." />}
      </Panel>
    </DashboardLayout>
  )
}

function statusStyle(status) {
  if (status === 'PAID') return 'bg-emerald-100 text-emerald-800'
  if (status === 'PARTIAL') return 'bg-sky-100 text-sky-800'
  if (status === 'OVERDUE') return 'bg-rose-100 text-rose-800'
  return 'bg-amber-100 text-amber-800'
}

function BillDetail({ label, value, emphasis = false }) {
  return <div className="rounded-xl border border-[#dceee1] bg-[#f5fbf6] p-3"><p className="text-xs font-bold uppercase tracking-[0.1em] text-slate-500">{label}</p><p className={`mt-1 font-bold ${emphasis ? 'text-rose-700' : 'text-slate-900'}`}>{value}</p></div>
}

function BillsSkeleton() {
  return (
    <div className="space-y-4 animate-pulse" aria-label="Loading published SOAs" role="status">
      <span className="sr-only">Loading published SOAs…</span>
      {Array.from({ length: 2 }, (_, index) => <article key={index} className="overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm"><div className="flex flex-col gap-4 bg-emerald-50/70 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="space-y-2"><div className="h-3 w-36 rounded bg-emerald-200" /><div className="h-7 w-28 rounded bg-emerald-200" /></div><div className="flex items-center gap-3"><div className="h-10 w-28 rounded bg-emerald-200" /><div className="h-10 w-24 rounded-lg bg-emerald-300" /></div></div><div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }, (_, detailIndex) => <div key={detailIndex} className="h-20 rounded-xl bg-emerald-50" />)}</div></article>)}
    </div>
  )
}
