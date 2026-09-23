import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Clock3, CreditCard, XCircle } from 'lucide-react'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

const filters = ['ALL', 'PENDING', 'APPROVED', 'REJECTED']

function money(value) {
  return `PHP ${Number(value || 0).toFixed(2)}`
}

function methodLabel(value) {
  return value ? value.replace('_', ' ') : 'Not set'
}

export default function ResidentPaymentsPage() {
  const { token } = useAuth()
  const [status, setStatus] = useState('ALL')
  const [payments, setPayments] = useState([])
  const [allPayments, setAllPayments] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    const query = status === 'ALL' ? '' : `?status=${status}`
    Promise.all([
      apiRequest(`/api/payments${query}`, { token }),
      apiRequest('/api/payments', { token }),
    ])
      .then(([filteredData, allData]) => {
        setPayments(filteredData.payments)
        setAllPayments(allData.payments)
      })
      .catch((requestError) => setError(requestError.message))
  }, [status, token])

  const summary = useMemo(() => ({
    pending: allPayments.filter((payment) => payment.reviewStatus === 'PENDING').length,
    approved: allPayments.filter((payment) => payment.reviewStatus === 'APPROVED').length,
    rejected: allPayments.filter((payment) => payment.reviewStatus === 'REJECTED').length,
  }), [allPayments])

  return (
    <DashboardLayout title="My payment history" description="Track pending, approved, and rejected receipt submissions.">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="grid gap-4 md:grid-cols-3">
        <Card icon={Clock3} label="Pending review" value={summary.pending} accent="blue" />
        <Card icon={CheckCircle2} label="Approved" value={summary.approved} accent="green" />
        <Card icon={XCircle} label="Rejected" value={summary.rejected} accent="red" />
      </div>

      <Panel title="Submitted payment proofs">
        <div className="payment-filter-bar mb-5 flex flex-wrap gap-2">
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
        </div>

        <div className="space-y-4">
          {payments.map((payment) => (
            <article key={payment.id} className="payment-record-card">
              <div className="flex flex-col gap-5 border-b border-[#d9e7dd] pb-5 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--primary)]">The ResiDens</p>
                  <h2 className="mt-2 flex items-center gap-2 text-xl font-black text-slate-950"><CreditCard size={20} className="text-[var(--primary)]" />Payment submission</h2>
                  <p className="mt-2 text-sm text-slate-500">Unit {payment.unitNumber} <span className="mx-1 text-slate-300">·</span> Submitted {new Date(payment.submittedAt).toLocaleString()}</p>
                </div>
                <div className="text-left sm:text-right">
                  <span className={`payment-status-badge ${payment.reviewStatus === 'APPROVED' ? 'payment-status-approved' : payment.reviewStatus === 'REJECTED' ? 'payment-status-rejected' : 'payment-status-pending'}`}>{payment.reviewStatus}</span>
                  <p className="mt-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">Verified amount</p>
                  <p className="mt-1 text-2xl font-black text-slate-950">{payment.verifiedAmount ? money(payment.verifiedAmount) : 'Pending'}</p>
                </div>
              </div>
              <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <MiniInfo label="OCR amount" value={payment.ocrAmount ? money(payment.ocrAmount) : 'Not detected'} />
                <MiniInfo label="Method" value={methodLabel(payment.paymentMethod)} />
                <MiniInfo label="Reference" value={payment.verifiedReferenceNo || payment.ocrReferenceNo || 'Not detected'} />
                <MiniInfo label="Applied amount" value={money(payment.appliedAmount)} />
                <MiniInfo label="Advance balance" value={money(payment.unitAdvanceBalance)} />
                <MiniInfo label="Remaining balance" value={money(payment.remainingBalance)} />
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                {payment.targetBillId && <Link to={`/resident/bills/${payment.targetBillId}`} className="resident-soa-button resident-soa-button-green">Open SOA <span aria-hidden="true">→</span></Link>}
              </div>
              {payment.remarks && <p className="payment-remarks mt-4 rounded-xl p-3 text-sm text-slate-600">{payment.remarks}</p>}
            </article>
          ))}
        </div>

        {payments.length === 0 && <EmptyRow message="No payment submissions match this filter yet." />}
      </Panel>
    </DashboardLayout>
  )
}

function Card({ icon: Icon, label, value, accent }) {
  return <div className={`resident-summary-card payment-summary-${accent}`}><div><p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p><p className="mt-2 text-3xl font-black text-slate-950">{value}</p></div><div className="resident-card-icon"><Icon size={19} /></div></div>
}

function MiniInfo({ label, value }) {
  return (
    <div className="payment-info-box rounded-xl p-3">
      <p className="text-xs font-bold uppercase text-slate-400">{label}</p>
      <p className="mt-1 font-semibold text-slate-900">{value}</p>
    </div>
  )
}
