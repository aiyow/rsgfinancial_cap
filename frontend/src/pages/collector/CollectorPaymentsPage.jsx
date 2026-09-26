import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BadgeCheck, CircleDollarSign, FileText, WalletCards } from 'lucide-react'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

function money(value) {
  return `PHP ${Number(value || 0).toFixed(2)}`
}

function methodLabel(value) {
  return value ? value.replace('_', ' ') : 'Not set'
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
        <SummaryCard label="Approved payments" value={summary.approvals} icon={WalletCards} accent="blue" />
        <SummaryCard label="Approved amount" value={money(summary.collected)} icon={CircleDollarSign} accent="green" />
        <SummaryCard label="Fully paid SOAs" value={summary.paidBills} icon={BadgeCheck} accent="red" />
      </div>

      <Panel title="Approved records">
        {payments.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1060px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-3 text-left font-bold">Unit</th>
                  <th className="px-3 py-3 text-left font-bold">Resident</th>
                  <th className="px-3 py-3 text-left font-bold">Method / source</th>
                  <th className="px-3 py-3 text-left font-bold">Reference</th>
                  <th className="px-3 py-3 text-left font-bold">Paid on</th>
                  <th className="px-3 py-3 text-left font-bold">Applied</th>
                  <th className="px-3 py-3 text-left font-bold">Approved amount</th>
                  <th className="px-3 py-3 text-left font-bold">SOA status</th>
                  <th className="px-3 py-3 text-right font-bold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.map((payment) => (
                  <tr key={payment.id} className="transition hover:bg-slate-50">
                    <td className="px-3 py-3 font-bold">Unit {payment.unitNumber}</td>
                    <td className="px-3 py-3">{payment.submittedByName}</td>
                    <td className="px-3 py-3">
                      <p className="font-semibold text-slate-800">{methodLabel(payment.paymentMethod)}</p>
                      <p className="text-xs text-slate-500">{payment.entryType === 'MANUAL' ? 'Manual entry' : 'Receipt upload'}</p>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">{payment.verifiedReferenceNo}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{payment.verifiedPaymentDate ? String(payment.verifiedPaymentDate).slice(0, 10) : '-'}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{money(payment.appliedAmount)}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{money(payment.verifiedAmount)}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${payment.paymentStatus === 'PAID' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                        {payment.paymentStatus}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      {payment.targetBillId && (
                        <Link
                          to={`/collector/bills/${payment.targetBillId}`}
                          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800 shadow-sm transition hover:border-emerald-700 hover:bg-emerald-700 hover:text-white hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
                        >
                          <FileText size={14} aria-hidden="true" />
                          Open SOA
                        </Link>
                      )}
                    </td>
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

function SummaryCard({ accent, icon: Icon, label, value }) {
  return (
    <div className={`collector-metric collector-metric-${accent} rounded-2xl border border-slate-200 p-5 shadow-sm`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-500">{label}</p>
          <p className="mt-3 text-3xl font-black text-[var(--ink)]">{value}</p>
        </div>
        <span className="grid size-11 place-items-center rounded-xl">
          <Icon size={21} />
        </span>
      </div>
    </div>
  )
}
