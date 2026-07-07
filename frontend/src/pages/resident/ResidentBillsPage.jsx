import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

function money(value) {
  return `PHP ${Number(value || 0).toFixed(2)}`
}

export default function ResidentBillsPage() {
  const { token } = useAuth()
  const [bills, setBills] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    apiRequest('/api/bills', { token })
      .then((data) => setBills(data.bills))
      .catch((requestError) => setError(requestError.message))
  }, [token])

  const summary = useMemo(() => ({
    count: bills.length,
    unpaid: bills.filter((bill) => ['UNPAID', 'OVERDUE'].includes(bill.paymentStatus)).length,
    balance: bills.reduce((sum, bill) => sum + Number(bill.remainingBalance || 0), 0),
  }), [bills])

  return (
    <DashboardLayout title="My Statements of Account" description="Open each published SOA, check the remaining balance, and submit payment proof.">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard label="Published SOAs" value={summary.count} />
        <SummaryCard label="Need payment" value={summary.unpaid} />
        <SummaryCard label="Total remaining" value={money(summary.balance)} />
      </div>

      <Panel title="Published billing statements">
        <div className="space-y-4">
          {bills.map((bill) => (
            <article key={bill.id} className="rounded-2xl border border-slate-200 p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-black text-slate-950">Unit {bill.unitNumber}</h2>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${bill.paymentStatus === 'PAID' ? 'bg-emerald-50 text-emerald-700' : bill.paymentStatus === 'PARTIAL' ? 'bg-sky-50 text-sky-700' : bill.paymentStatus === 'OVERDUE' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>{bill.paymentStatus}</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-500">
                    Billing period {String(bill.periodStart).slice(0, 10)} to {String(bill.periodEnd).slice(0, 10)} | Due {String(bill.dueDate).slice(0, 10)}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-xs font-bold uppercase text-slate-400">Remaining balance</p>
                  <p className="mt-1 text-2xl font-black text-slate-950">{money(bill.remainingBalance)}</p>
                </div>
              </div>
              <div className="mt-4 grid gap-3 text-sm text-slate-600 sm:grid-cols-3">
                <Info label="Total amount" value={money(bill.totalAmount)} />
                <Info label="Approved payments" value={money(bill.approvedAmount)} />
                <Info label="Pending review" value={bill.hasPendingPayment ? 'Yes' : 'No'} />
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link to={`/resident/bills/${bill.id}`} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white">Open SOA</Link>
              </div>
            </article>
          ))}
        </div>
        {bills.length === 0 && <EmptyRow message="No published SOAs are available for your assigned units yet." />}
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

function Info({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-xs font-bold uppercase text-slate-400">{label}</p>
      <p className="mt-1 font-semibold text-slate-900">{value}</p>
    </div>
  )
}
