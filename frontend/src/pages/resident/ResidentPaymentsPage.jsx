import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Clock3 } from 'lucide-react'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

const filters = ['ALL', 'PENDING', 'APPROVED', 'REJECTED']

function money(value) {
  return `PHP ${new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0))}`
}

function methodLabel(value) {
  return value ? value.replace('_', ' ') : 'Not set'
}

function dateTimeLabel(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const label = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)
  return label.replace(/^([A-Za-z]{3})/, '$1.')
}

export default function ResidentPaymentsPage() {
  const { token } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [status, setStatus] = useState(() => location.state?.filter || 'ALL')
  const [payments, setPayments] = useState([])
  const [error, setError] = useState('')
  const [submissionNotice, setSubmissionNotice] = useState(() => location.state?.submissionNotice || '')

  useEffect(() => {
    if (!location.state?.submissionNotice) return
    setSubmissionNotice(location.state.submissionNotice)
    if (location.state.filter) setStatus(location.state.filter)
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, navigate])

  useEffect(() => {
    const query = status === 'ALL' ? '' : `?status=${status}`
    apiRequest(`/api/payments${query}`, { token })
      .then((data) => setPayments(data.payments))
      .catch((requestError) => setError(requestError.message))
  }, [status, token])

  return (
    <DashboardLayout title="My payment history" description="Track pending, approved, and rejected receipt submissions.">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {submissionNotice && <section role="status" className="flex items-start justify-between gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950 shadow-sm"><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-emerald-700 shadow-sm"><Clock3 size={20} /></span><div><p className="font-black">Payment proof submitted</p><p className="mt-1 text-sm leading-5 text-emerald-800">{submissionNotice}</p></div></div><button type="button" onClick={() => setSubmissionNotice('')} className="rounded-lg px-2 py-1 text-sm font-bold text-emerald-800 transition hover:bg-emerald-100">Dismiss</button></section>}

      <Panel title="Submitted payment proofs" description="Check the review status and payment details for each receipt you have submitted.">
        <div className="payment-filter-bar mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm font-semibold text-slate-600">Filter by status</p><div className="flex flex-wrap gap-2">
          {filters.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => { setStatus(item); setError('') }}
              className={`payment-filter ${status === item ? 'payment-filter-active' : ''}`}
            >
              {item === 'ALL' ? 'All submissions' : item}
            </button>
          ))}
        </div></div>

        <div className="space-y-4">
          {payments.map((payment) => (
            <article key={payment.id} className="payment-record-card overflow-hidden">
              <div className="flex flex-col gap-4 border-b border-[#d9e7dd] bg-emerald-50/50 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--primary)]">Payment submission</p>
                  <h2 className="mt-1 text-xl font-black text-slate-950">Unit {payment.unitNumber}</h2>
                  <p className="mt-1 text-sm text-slate-500">Submitted {dateTimeLabel(payment.submittedAt)}</p>
                </div>
                <div className="flex items-center justify-between gap-4 sm:block sm:text-right">
                  <span className={`payment-status-badge ${payment.reviewStatus === 'APPROVED' ? 'payment-status-approved' : payment.reviewStatus === 'REJECTED' ? 'payment-status-rejected' : 'payment-status-pending'}`}>{payment.reviewStatus}</span>
                  <div><p className="mt-0 text-xs font-bold uppercase tracking-[0.12em] text-slate-400 sm:mt-3">Verified amount</p>
                  <p className="mt-1 text-2xl font-black text-slate-950">{payment.verifiedAmount ? money(payment.verifiedAmount) : 'Pending'}</p>
                  </div>
                </div>
              </div>
              <div className="grid gap-3 p-4 text-sm sm:grid-cols-2 lg:grid-cols-3 sm:p-5">
                <MiniInfo label="OCR amount" value={payment.ocrAmount ? money(payment.ocrAmount) : 'Not detected'} />
                <MiniInfo label="Method" value={methodLabel(payment.paymentMethod)} />
                <MiniInfo label="Reference" value={payment.verifiedReferenceNo || payment.ocrReferenceNo || 'Not detected'} />
                <MiniInfo label="Applied amount" value={money(payment.appliedAmount)} />
                <MiniInfo label="Advance balance" value={money(payment.unitAdvanceBalance)} />
                <MiniInfo label="Remaining balance" value={money(payment.remainingBalance)} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#d9e7dd] px-4 py-3 sm:px-5">
                {payment.remarks ? <p className="text-sm text-slate-600">{payment.remarks}</p> : <span />}
                {payment.targetBillId && <Link to={`/resident/bills/${payment.targetBillId}`} className="resident-soa-button resident-soa-button-green">Open SOA</Link>}
              </div>
            </article>
          ))}
        </div>

        {payments.length === 0 && <EmptyRow message="No payment submissions match this filter yet." />}
      </Panel>
    </DashboardLayout>
  )
}

function MiniInfo({ label, value }) {
  return (
    <div className="payment-info-box rounded-xl p-3">
      <p className="text-xs font-bold uppercase text-slate-400">{label}</p>
      <p className="mt-1 font-semibold text-slate-900">{value}</p>
    </div>
  )
}
