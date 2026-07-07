import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

export default function ResidentDashboard() {
  const { token } = useAuth()
  const [bills, setBills] = useState([])
  const [payments, setPayments] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      apiRequest('/api/bills', { token }),
      apiRequest('/api/payments', { token }),
    ])
      .then(([billData, paymentData]) => {
        setBills(billData.bills)
        setPayments(paymentData.payments)
      })
      .catch((requestError) => setError(requestError.message))
  }, [token])

  const summary = useMemo(() => ({
    publishedSoas: bills.length,
    unpaid: bills.filter((bill) => ['UNPAID', 'OVERDUE'].includes(bill.paymentStatus)).length,
    pendingPayments: payments.filter((payment) => payment.reviewStatus === 'PENDING').length,
  }), [bills, payments])

  return (
    <DashboardLayout title="Resident dashboard" description="View published SOAs, upload payment proofs, and track review status from one place.">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="grid gap-4 md:grid-cols-3">
        <DashboardCard label="Published SOAs" value={summary.publishedSoas} />
        <DashboardCard label="Need payment" value={summary.unpaid} />
        <DashboardCard label="Pending payment reviews" value={summary.pendingPayments} />
      </div>

      <Panel title="Recent published SOAs" description="Open any statement to print it or submit a receipt image for OCR review.">
        <div className="space-y-4">
          {bills.slice(0, 4).map((bill) => (
            <article key={bill.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-lg font-black text-slate-950">Unit {bill.unitNumber}</p>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${bill.paymentStatus === 'PAID' ? 'bg-emerald-50 text-emerald-700' : bill.paymentStatus === 'PARTIAL' ? 'bg-sky-50 text-sky-700' : bill.paymentStatus === 'OVERDUE' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>{bill.paymentStatus}</span>
                </div>
                <p className="mt-1 text-sm text-slate-500">Due {String(bill.dueDate).slice(0, 10)} | Remaining PHP {Number(bill.remainingBalance || 0).toFixed(2)}</p>
              </div>
              <Link to={`/resident/bills/${bill.id}`} className="w-fit rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white">Open SOA</Link>
            </article>
          ))}
        </div>
        {bills.length === 0 && <EmptyRow message="No published SOAs are visible yet. Admin needs to publish forwarded SOAs first." />}
      </Panel>

      <Panel title="Payment history shortcuts">
        <div className="flex flex-wrap gap-3">
          <Link to="/resident/bills" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold">View all SOAs</Link>
          <Link to="/resident/payments" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold">View payment history</Link>
        </div>
      </Panel>
    </DashboardLayout>
  )
}

function DashboardCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-black text-slate-950">{value}</p>
    </div>
  )
}
