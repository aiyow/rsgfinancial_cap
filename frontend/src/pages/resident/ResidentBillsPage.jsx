import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock3 } from 'lucide-react'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'
import { isWaterOnly, payableBalance, payablePaid } from '../../utils/chargePayments'
import ChargePaymentSummary from '../../components/ChargePaymentSummary'

function money(value) {
  return `₱${new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0))}`
}

function dateLabel(value) {
  const [year, month, day] = String(value || '').slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return '—'
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day)))
}

export default function ResidentBillsPage() {
  const { token } = useAuth()
  const [bills, setBills] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    queueMicrotask(() => { if (active) setLoading(true) })
    apiRequest('/api/bills', { token })
      .then((data) => { if (active) setBills(data.bills) })
      .catch((requestError) => { if (active) setError(requestError.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token])

  return (
    <DashboardLayout title="My Statements of Account" className="resident-shell resident-bills-shell">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <Panel className="resident-bills-panel" title="Published SOAs" description="Open a statement for details, payment QR, or receipt upload.">
        {loading ? <BillsSkeleton /> : <div className="space-y-3 sm:space-y-4">
          {bills.map((bill) => (
            <article key={bill.id} aria-labelledby={`resident-bill-${bill.id}`} className="resident-bill-list-card overflow-hidden rounded-xl border border-[#d8e8dc] bg-white shadow-sm sm:rounded-2xl">
              <div className="bg-emerald-50/60 p-3.5 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
                    <h3 id={`resident-bill-${bill.id}`} className="break-words text-lg font-black text-slate-950 sm:text-xl">Unit {bill.unitNumber}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black sm:text-xs ${statusStyle(bill.paymentStatus)}`}>{bill.paymentStatus}</span>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[11px] text-slate-500 sm:text-xs">Due date</p>
                    <p className={`mt-0.5 text-xs font-semibold sm:text-sm ${bill.paymentStatus === 'OVERDUE' ? 'text-rose-700' : 'text-slate-700'}`}><time dateTime={String(bill.dueDate || '').slice(0, 10)}>{dateLabel(bill.dueDate)}</time></p>
                  </div>
                </div>
                <p className="mt-1.5 text-[11px] leading-5 text-slate-600 sm:text-xs"><span className="font-medium">Period:</span> {dateLabel(bill.periodStart)} – {dateLabel(bill.periodEnd)}</p>
                <div className="mt-3 flex flex-wrap items-end justify-between gap-2 sm:mt-4">
                  <div><p className="text-[11px] font-medium text-slate-500 sm:text-xs">{isWaterOnly(bill) ? 'Water balance' : 'Balance due'}</p><p className="mt-0.5 text-xl font-black tracking-tight tabular-nums text-slate-950 sm:text-2xl">{money(payableBalance(bill))}</p></div>
                  <Link to={`/resident/bills/${bill.id}`} aria-label={`Open SOA for Unit ${bill.unitNumber}, ${dateLabel(bill.periodStart)} to ${dateLabel(bill.periodEnd)}`} className="resident-soa-button resident-soa-button-green min-h-11 shrink-0 justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">Open SOA</Link>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-3 border-t border-[#d9e7dd] px-3.5 py-2.5 sm:px-5 sm:py-3">
                <BillDetail label="Total amount" value={money(bill.totalAmount)} />
                <BillDetail label={isWaterOnly(bill) ? 'Water paid' : 'Approved payments'} value={money(payablePaid(bill))} />
              </dl>
              <div className="px-3.5 pb-3 sm:px-5"><ChargePaymentSummary bill={bill} /></div>
              {(bill.hasPayablePendingPayment ?? bill.hasPendingPayment) && <p className="mx-3.5 mb-3 flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-xs font-medium text-amber-800 sm:mx-5 sm:mb-4" role="status"><Clock3 size={14} className="shrink-0" aria-hidden="true" />Receipt awaiting Admin review</p>}
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

function BillDetail({ label, value }) {
  return <div className="min-w-0"><dt className="text-[11px] font-medium text-slate-500 sm:text-xs">{label}</dt><dd className="mt-0.5 break-words text-xs font-semibold tabular-nums text-slate-900 sm:text-sm">{value}</dd></div>
}

function BillsSkeleton() {
  return (
    <div className="space-y-3 animate-pulse sm:space-y-4" aria-label="Loading published SOAs" role="status">
      <span className="sr-only">Loading published SOAs…</span>
      {Array.from({ length: 2 }, (_, index) => <article key={index} className="overflow-hidden rounded-xl border border-emerald-100 bg-white shadow-sm"><div className="space-y-2 bg-emerald-50/70 p-3.5 sm:p-5"><div className="flex justify-between gap-3"><div className="h-6 w-28 rounded bg-emerald-200" /><div className="h-6 w-24 rounded bg-emerald-100" /></div><div className="h-3 w-48 max-w-full rounded bg-emerald-100" /><div className="flex items-end justify-between pt-2"><div className="h-10 w-28 rounded bg-emerald-200" /><div className="h-11 w-24 rounded-lg bg-emerald-300" /></div></div><div className="grid grid-cols-2 gap-3 px-3.5 py-2.5 sm:px-5">{Array.from({ length: 2 }, (_, detailIndex) => <div key={detailIndex} className="h-8 rounded bg-emerald-50" />)}</div></article>)}
    </div>
  )
}
