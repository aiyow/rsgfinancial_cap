import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal, X } from 'lucide-react'
import { currency, purposeLabels } from '../utils/chargePayments'
import { paymentMethodLabel } from '../utils/paymentHistory'
import { defaultPaymentFilters, filterPaymentQueue, paginatePaymentQueue, paymentQueueAmount } from '../utils/paymentQueue'

const statuses = { ALL: 'All', PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected' }
const badgeClasses = { PENDING: 'bg-amber-50 text-amber-800', APPROVED: 'bg-emerald-50 text-emerald-800', REJECTED: 'bg-rose-50 text-rose-800' }
const sorting = { NEWEST: 'Newest received', OLDEST: 'Oldest received', PENDING_FIRST: 'Pending first', UNIT: 'Unit number', RESIDENT: 'Resident name', AMOUNT_HIGH: 'Amount: high to low', AMOUNT_LOW: 'Amount: low to high' }

export default function AdminPaymentQueue({ payments, loading = false, error = '', approvedOnly = false, onViewDetails }) {
  const [filters, setFilters] = useState({ ...defaultPaymentFilters })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [moreFilters, setMoreFilters] = useState(false)
  const filtered = useMemo(() => filterPaymentQueue(payments, filters), [payments, filters])
  const result = paginatePaymentQueue(filtered, page, pageSize)
  const extraCount = ['purpose', 'method', 'source'].filter(key => filters[key] !== 'ALL').length + Number(Boolean(filters.dateFrom || filters.dateTo))
  const hasFilters = ['search', 'status', 'purpose', 'method', 'source', 'dateFrom', 'dateTo'].some(key => filters[key] !== defaultPaymentFilters[key])
  const invalidDates = filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo

  function update(key, value) { setFilters(current => ({ ...current, [key]: value })); setPage(1) }
  function reset() { setFilters({ ...defaultPaymentFilters }); setPage(1) }

  return <section className="admin-payment-queue" aria-label="Payment queue">
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_190px]">
      <div className="relative">
        <Search size={17} className="pointer-events-none absolute left-3 top-3.5 text-slate-400" aria-hidden="true" />
        <input aria-label="Search payments" type="search" value={filters.search} onChange={event => update('search', event.target.value)} placeholder="Search resident, unit, reference or invoice" className="queue-search min-h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-10 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" />
        {filters.search && <button type="button" aria-label="Clear payment search" onClick={() => update('search', '')} className="absolute right-0 top-0 grid size-11 place-items-center rounded-lg text-slate-500 hover:text-emerald-800"><X size={15} /></button>}
      </div>
      <QueueSelect label="Sort payments" value={filters.sort} onChange={value => update('sort', value)} options={approvedOnly ? Object.fromEntries(Object.entries(sorting).filter(([key]) => key !== 'PENDING_FIRST')) : sorting} hideLabel />
    </div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
      {!approvedOnly && <div className="grid w-full grid-cols-4 gap-1 rounded-lg bg-slate-50 p-1 sm:w-auto" role="group" aria-label="Filter payment status">
        {Object.entries(statuses).map(([value, label]) => <button key={value} type="button" aria-pressed={filters.status === value} onClick={() => update('status', value)} className={`queue-status min-h-11 rounded-md px-2 font-bold focus-visible:outline-2 focus-visible:outline-emerald-600 sm:px-4 ${filters.status === value ? 'bg-emerald-700 text-white shadow-sm' : 'text-slate-600 hover:bg-emerald-100'}`}>{label}</button>)}
      </div>}
      <div className="ml-auto flex items-center gap-2">
        <button type="button" aria-expanded={moreFilters} aria-controls="payment-extra-filters" onClick={() => setMoreFilters(current => !current)} className={`queue-control inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 font-semibold ${extraCount ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-600'}`}><SlidersHorizontal size={15} />Filters{extraCount > 0 && <span className="rounded-full bg-emerald-700 px-1.5 text-white">{extraCount}</span>}</button>
        {hasFilters && <button type="button" onClick={reset} className="queue-control min-h-11 rounded-lg px-2 font-semibold text-emerald-800 underline underline-offset-2">Clear all</button>}
      </div>
    </div>
    {moreFilters && <div id="payment-extra-filters" className="mt-3 grid grid-cols-2 gap-3 rounded-xl border border-emerald-100 bg-slate-50 p-3 lg:grid-cols-5">
      <QueueSelect label="Payment purpose" value={filters.purpose} onChange={value => update('purpose', value)} options={{ ALL: 'All purposes', ...purposeLabels }} />
      <QueueSelect label="Payment method" value={filters.method} onChange={value => update('method', value)} options={{ ALL: 'All methods', GCASH: 'GCash', BANK_TRANSFER: 'Bank transfer', CASH: 'Cash', OTHER: 'Other' }} />
      <QueueSelect label="Payment source" value={filters.source} onChange={value => update('source', value)} options={{ ALL: 'All sources', RECEIPT_UPLOAD: 'Receipt upload', MANUAL: 'Manual entry' }} />
      <label className="min-w-0 text-xs font-semibold text-slate-600">Received from<input aria-label="Received from" type="date" value={filters.dateFrom} onChange={event => update('dateFrom', event.target.value)} className="queue-date mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2" /></label>
      <label className="min-w-0 text-xs font-semibold text-slate-600">Received through<input aria-label="Received through" type="date" value={filters.dateTo} onChange={event => update('dateTo', event.target.value)} className="queue-date mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2" /></label>
    </div>}
    {invalidDates && <p role="alert" className="mt-2 text-xs text-rose-700">The end date must be on or after the start date.</p>}
    <div className="my-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
      <p role="status" className="text-xs text-slate-500">{loading ? 'Loading payments…' : error ? 'Payments could not be loaded.' : `${result.total ? `${result.first}–${result.last} of ${result.total}` : '0'} matching payments`}{!loading && !error && hasFilters && ` · ${payments.length} total`}</p>
      <label className="flex items-center gap-2 text-xs text-slate-500">Per page<select aria-label="Payments per page" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1) }} className="min-h-11 rounded-lg border border-slate-200 bg-white px-2 text-xs">{[10, 25, 50].map(size => <option key={size}>{size}</option>)}</select></label>
    </div>
    <div aria-busy={loading}>
      {loading ? <div className="space-y-2 animate-pulse motion-reduce:animate-none" aria-label="Loading payment list">{[1, 2, 3].map(id => <div key={id} className="h-16 rounded-lg bg-slate-100" />)}</div> : error ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : result.total === 0 ? <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center"><p className="text-sm font-bold text-slate-700">No payments found</p><p className="mt-1 text-xs text-slate-500">{hasFilters ? 'Try a resident name or clear a filter to broaden your search.' : (approvedOnly ? 'No Admin-approved payments are available yet.' : 'Submitted and manually recorded payments will appear here.')}</p>{hasFilters && <button type="button" onClick={reset} className="queue-control mt-2 min-h-11 font-bold text-emerald-800 underline">Clear filters</button>}</div> : <>
        <div className="hidden overflow-x-auto rounded-lg border border-slate-100 md:block">
          <table className="w-full min-w-[720px] text-left text-sm"><caption className="sr-only">Payment summaries; open View Details for receipt, transaction and allocation information.</caption><thead className="bg-slate-50 text-xs text-slate-500"><tr>{['Resident / unit', 'Received', 'Amount', 'Source', approvedOnly ? 'SOA status' : 'Status', 'Action'].map(label => <th key={label} scope="col" className={`px-3 py-3 font-semibold ${label === 'Amount' ? 'text-right' : ''}`}>{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{result.rows.map(payment => <tr key={payment.id} className="hover:bg-slate-50/70">
            <td className="max-w-56 px-3 py-2.5"><p className="truncate font-semibold text-slate-900" title={payment.submittedByName}>{payment.submittedByName || 'Unknown resident'}</p><p className="mt-0.5 text-xs text-slate-500">Unit {payment.unitNumber || '—'}</p></td>
            <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-600">{receivedLabel(payment.submittedAt)}</td>
            <td className="whitespace-nowrap px-3 py-2.5 text-right"><PaymentAmount payment={payment} /></td>
            <td className="px-3 py-2.5 text-xs"><p className="font-medium text-slate-700">{payment.entryType === 'MANUAL' ? 'Manual entry' : 'Receipt upload'}</p><p className="mt-0.5 text-slate-500">{paymentMethodLabel(payment.paymentMethod)}</p></td>
            <td className="px-3 py-2.5"><PaymentStatus payment={payment} approvedOnly={approvedOnly} /></td><td className="px-3 py-2.5"><PaymentLink payment={payment} onViewDetails={onViewDetails} /></td>
          </tr>)}</tbody></table>
        </div>
        <div className="grid gap-2 md:hidden">{result.rows.map(payment => <article key={payment.id} className="min-w-0 rounded-xl border border-emerald-100 p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="truncate text-sm font-bold text-slate-900">{payment.submittedByName || 'Unknown resident'}</h3><p className="mt-0.5 text-xs text-slate-500">Unit {payment.unitNumber || '—'} · {receivedLabel(payment.submittedAt)}</p></div><PaymentStatus payment={payment} approvedOnly={approvedOnly} /></div><div className="mt-2 flex items-center justify-between gap-2"><PaymentAmount payment={payment} /><PaymentLink payment={payment} onViewDetails={onViewDetails} /></div></article>)}</div>
      </>}
    </div>
    {!loading && !error && result.total > 0 && <nav aria-label="Payment pagination" className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3"><button type="button" disabled={result.page <= 1} onClick={() => setPage(result.page - 1)} className="queue-control inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-200 px-3 font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft size={15} />Previous</button><span className="text-xs text-slate-500">Page {result.page} of {result.pageCount}</span><button type="button" disabled={result.page >= result.pageCount} onClick={() => setPage(result.page + 1)} className="queue-control inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-200 px-3 font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">Next<ChevronRight size={15} /></button></nav>}
  </section>
}

function QueueSelect({ label, value, onChange, options, hideLabel }) {
  return <label className="min-w-0 text-xs font-semibold text-slate-600"><span className={hideLabel ? 'sr-only' : ''}>{label}</span><select value={value} onChange={event => onChange(event.target.value)} className={`min-h-11 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-xs ${hideLabel ? '' : 'mt-1'}`}>{Object.entries(options).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
}
function receivedLabel(value) {
  const date = new Date(value)
  return !value || Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' })
}
function PaymentAmount({ payment }) {
  const amount = paymentQueueAmount(payment)
  return <div><p className="font-bold tabular-nums text-slate-900">{amount === null ? 'Not detected' : currency(amount)}</p><p className="mt-0.5 text-[10px] text-slate-500">{payment.reviewStatus === 'APPROVED' ? 'Verified' : 'Detected · unverified'}</p></div>
}
function PaymentStatus({ payment, approvedOnly }) {
  if (approvedOnly) return <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${payment.paymentStatus === 'PAID' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{payment.paymentStatus || 'Approved'}</span>
  return <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${badgeClasses[payment.reviewStatus] || 'bg-slate-100 text-slate-600'}`}>{statuses[payment.reviewStatus] || payment.reviewStatus}</span>
}
function PaymentLink({ payment, onViewDetails }) {
  if (onViewDetails) return <button type="button" onClick={() => onViewDetails(payment)} aria-label={`View payment details ${payment.id} for ${payment.submittedByName || 'resident'}, Unit ${payment.unitNumber}`} className="inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-800 hover:bg-emerald-100 focus-visible:outline-2 focus-visible:outline-emerald-600">View Details</button>
  return <Link to={`/admin/payments/${payment.id}`} aria-label={`${payment.reviewStatus === 'PENDING' ? 'Review payment' : 'View payment details'} ${payment.id} for ${payment.submittedByName || 'resident'}, Unit ${payment.unitNumber}`} className="inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-800 hover:bg-emerald-100 focus-visible:outline-2 focus-visible:outline-emerald-600">{payment.reviewStatus === 'PENDING' ? 'Review' : 'View Details'}</Link>
}
