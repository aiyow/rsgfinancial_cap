import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

const filters = ['ALL', 'PENDING', 'APPROVED', 'REJECTED']

function money(value) {
  return `PHP ${Number(value || 0).toFixed(2)}`
}

export default function ResidentPaymentsPage() {
  const { token } = useAuth()
  const [status, setStatus] = useState('ALL')
  const [payments, setPayments] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    const query = status === 'ALL' ? '' : `?status=${status}`
    apiRequest(`/api/payments${query}`, { token })
      .then((data) => setPayments(data.payments))
      .catch((requestError) => setError(requestError.message))
  }, [status, token])

  const summary = useMemo(() => ({
    pending: payments.filter((payment) => payment.reviewStatus === 'PENDING').length,
    approved: payments.filter((payment) => payment.reviewStatus === 'APPROVED').length,
    rejected: payments.filter((payment) => payment.reviewStatus === 'REJECTED').length,
  }), [payments])

  return (
    <DashboardLayout title="My payment history" description="Track pending, approved, and rejected receipt submissions.">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="grid gap-4 md:grid-cols-3">
        <Card label="Pending review" value={summary.pending} />
        <Card label="Approved" value={summary.approved} />
        <Card label="Rejected" value={summary.rejected} />
      </div>

      <Panel title="Submitted payment proofs">
        <div className="mb-5 flex flex-wrap gap-2">
          {filters.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => { setStatus(item); setError('') }}
              className={`rounded-full px-4 py-2 text-sm font-bold ${status === item ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              {item === 'ALL' ? 'All submissions' : item}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          {payments.map((payment) => (
            <article key={payment.id} className="rounded-2xl border border-slate-200 p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-black text-slate-950">Unit {payment.unitNumber}</h2>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${payment.reviewStatus === 'APPROVED' ? 'bg-emerald-50 text-emerald-700' : payment.reviewStatus === 'REJECTED' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>{payment.reviewStatus}</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-500">Submitted {new Date(payment.submittedAt).toLocaleString()}</p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-xs font-bold uppercase text-slate-400">Verified amount</p>
                  <p className="mt-1 text-2xl font-black text-slate-950">{payment.verifiedAmount ? money(payment.verifiedAmount) : 'Pending'}</p>
                </div>
              </div>
              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                <MiniInfo label="OCR amount" value={payment.ocrAmount ? money(payment.ocrAmount) : 'Not detected'} />
                <MiniInfo label="Reference" value={payment.verifiedReferenceNo || payment.ocrReferenceNo || 'Not detected'} />
                <MiniInfo label="Remaining balance" value={money(payment.remainingBalance)} />
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link to={`/resident/bills/${payment.unitBillId}`} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold">Open related SOA</Link>
              </div>
              {payment.remarks && <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{payment.remarks}</p>}
            </article>
          ))}
        </div>

        {payments.length === 0 && <EmptyRow message="No payment submissions match this filter yet." />}
      </Panel>
    </DashboardLayout>
  )
}

function Card({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-black text-slate-950">{value}</p>
    </div>
  )
}

function MiniInfo({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-xs font-bold uppercase text-slate-400">{label}</p>
      <p className="mt-1 font-semibold text-slate-900">{value}</p>
    </div>
  )
}
