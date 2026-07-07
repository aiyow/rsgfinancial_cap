import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

function money(value) {
  return `PHP ${Number(value || 0).toFixed(2)}`
}

export default function CollectorPaymentsPage() {
  const { token } = useAuth()
  const [payments, setPayments] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    apiRequest('/api/payments?status=APPROVED', { token })
      .then((data) => setPayments(data.payments))
      .catch((requestError) => setError(requestError.message))
  }, [token])

  const summary = useMemo(() => ({
    approvals: payments.length,
    collected: payments.reduce((sum, payment) => sum + Number(payment.verifiedAmount || 0), 0),
    paidBills: payments.filter((payment) => payment.paymentStatus === 'PAID').length,
  }), [payments])

  return (
    <DashboardLayout title="Verified payment records" description="Read-only payment results approved by Admin.">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard label="Approved payments" value={summary.approvals} />
        <SummaryCard label="Approved amount" value={money(summary.collected)} />
        <SummaryCard label="Fully paid SOAs" value={summary.paidBills} />
      </div>

      <Panel title="Approved records">
        {payments.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr>
                  <th className="pb-3">Unit</th>
                  <th>Resident</th>
                  <th>Reference</th>
                  <th>Paid on</th>
                  <th>Approved amount</th>
                  <th>SOA status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td className="py-3 font-bold">Unit {payment.unitNumber}</td>
                    <td>{payment.submittedByName}</td>
                    <td>{payment.verifiedReferenceNo}</td>
                    <td>{payment.verifiedPaymentDate ? String(payment.verifiedPaymentDate).slice(0, 10) : '—'}</td>
                    <td>{money(payment.verifiedAmount)}</td>
                    <td>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${payment.paymentStatus === 'PAID' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                        {payment.paymentStatus}
                      </span>
                    </td>
                    <td><Link to={`/collector/bills/${payment.unitBillId}`} className="font-bold text-indigo-600">Open SOA</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {payments.length === 0 && <EmptyRow message="No Admin-approved payments are available yet." />}
      </Panel>
    </DashboardLayout>
  )
}

function SummaryCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-black text-slate-950">{value}</p>
    </div>
  )
}
