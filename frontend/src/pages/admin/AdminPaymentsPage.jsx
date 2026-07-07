import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

const statuses = ['ALL', 'PENDING', 'APPROVED', 'REJECTED']
const badgeClass = {
  PENDING: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-emerald-50 text-emerald-700',
  REJECTED: 'bg-rose-50 text-rose-700',
}

function money(value) {
  return `PHP ${Number(value || 0).toFixed(2)}`
}

function dateTime(value) {
  return value ? new Date(value).toLocaleString() : '—'
}

export default function AdminPaymentsPage() {
  const location = useLocation()
  const { token } = useAuth()
  const [status, setStatus] = useState('ALL')
  const [payments, setPayments] = useState([])
  const [notice, setNotice] = useState({ error: '', message: location.state?.message || '' })

  useEffect(() => {
    let active = true
    const query = status === 'ALL' ? '' : `?status=${status}`
    apiRequest(`/api/payments${query}`, { token })
      .then((data) => { if (active) setPayments(data.payments) })
      .catch((requestError) => { if (active) setNotice((current) => ({ ...current, error: requestError.message })) })
    return () => { active = false }
  }, [status, token])

  const counts = useMemo(() => ({
    total: payments.length,
    pending: payments.filter((payment) => payment.reviewStatus === 'PENDING').length,
    approved: payments.filter((payment) => payment.reviewStatus === 'APPROVED').length,
    rejected: payments.filter((payment) => payment.reviewStatus === 'REJECTED').length,
  }), [payments])

  return (
    <DashboardLayout title="Resident payment proofs" description="Review OCR results, open receipt images, and approve or reject Resident submissions.">
      {(notice.error || notice.message) && <p className={`rounded-lg p-3 text-sm ${notice.error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{notice.error || notice.message}</p>}

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Loaded payments" value={counts.total} />
        <StatCard label="Pending review" value={counts.pending} accent="amber" />
        <StatCard label="Approved" value={counts.approved} accent="emerald" />
        <StatCard label="Rejected" value={counts.rejected} accent="rose" />
      </div>

      <Panel title="Payment queue" description="Open a payment proof to inspect the receipt and finalize verification.">
        <div className="mb-5 flex flex-wrap gap-2">
          {statuses.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => { setStatus(item); setNotice((current) => ({ ...current, error: '' })) }}
              className={`rounded-full px-4 py-2 text-sm font-bold ${status === item ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {item === 'ALL' ? 'All statuses' : item}
            </button>
          ))}
        </div>

        {payments.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr>
                  <th className="pb-3">Unit</th>
                  <th>Resident</th>
                  <th>Submitted</th>
                  <th>OCR amount</th>
                  <th>Verified amount</th>
                  <th>Balance after approval</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td className="py-3 font-bold">Unit {payment.unitNumber}</td>
                    <td>
                      <p className="font-semibold text-slate-800">{payment.submittedByName}</p>
                      <p className="text-xs text-slate-500">Due {String(payment.dueDate || '').slice(0, 10) || '—'}</p>
                    </td>
                    <td>{dateTime(payment.submittedAt)}</td>
                    <td>{payment.ocrAmount ? money(payment.ocrAmount) : 'Not detected'}</td>
                    <td>{payment.verifiedAmount ? money(payment.verifiedAmount) : '—'}</td>
                    <td>{money(payment.remainingBalance)}</td>
                    <td><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${badgeClass[payment.reviewStatus]}`}>{payment.reviewStatus}</span></td>
                    <td><Link to={`/admin/payments/${payment.id}`} className="font-bold text-indigo-600">{payment.reviewStatus === 'PENDING' ? 'Review payment' : 'Open details'}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {payments.length === 0 && <EmptyRow message="No payment submissions match the current filter." />}
      </Panel>
    </DashboardLayout>
  )
}

function StatCard({ label, value, accent = 'slate' }) {
  const accentClass = {
    slate: 'bg-slate-100 text-slate-900',
    amber: 'bg-amber-50 text-amber-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    rose: 'bg-rose-50 text-rose-700',
  }[accent]

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <div className="mt-3 flex items-center justify-between">
        <p className="text-3xl font-black text-slate-950">{value}</p>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${accentClass}`}>{label}</span>
      </div>
    </div>
  )
}
