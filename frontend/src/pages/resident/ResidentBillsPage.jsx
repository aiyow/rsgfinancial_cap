import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CreditCard, FileCheck2, WalletCards } from 'lucide-react'
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
    advance: bills.reduce((sum, bill) => sum + Number(bill.advanceBalance || 0), 0),
  }), [bills])

  return (
    <DashboardLayout title="My Statements of Account" description="Open each published SOA, check the remaining balance, and submit payment proof.">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard icon={FileCheck2} label="Published SOAs" value={summary.count} accent="blue" />
        <SummaryCard icon={CreditCard} label="Need payment" value={summary.unpaid} accent="green" />
        <SummaryCard icon={WalletCards} label="Total remaining" value={money(summary.balance)} accent="red" />
        <SummaryCard icon={WalletCards} label="Advance balance" value={money(summary.advance)} accent="green" />
      </div>

      <Panel title="Published billing statements">
        <div className="space-y-4">
          {bills.map((bill) => (
            <article key={bill.id} className="resident-soa-card">
              <div className="flex flex-col gap-5 border-b border-[#d9e7dd] pb-5 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--primary)]">RSG Condo</p>
                  <h2 className="mt-2 text-xl font-black text-slate-950">Statement of Account</h2>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">Account</p>
                  <p className="mt-1 text-lg font-black text-slate-950">Unit {bill.unitNumber}</p>
                  <p className="mt-1 text-sm text-slate-500">Billing period: {String(bill.periodStart).slice(0, 10)} – {String(bill.periodEnd).slice(0, 10)}</p>
                  <p className="mt-1 text-sm font-bold text-slate-700">Due: {String(bill.dueDate).slice(0, 10)}</p>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2"><span className={`resident-status-dot ${bill.paymentStatus === 'PAID' ? 'bg-emerald-500' : bill.paymentStatus === 'PARTIAL' ? 'bg-sky-500' : bill.paymentStatus === 'OVERDUE' ? 'bg-rose-500' : 'bg-amber-500'}`} /><span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{bill.paymentStatus}</span></div>
                <div className="text-left sm:text-right"><p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">Remaining balance</p><p className="mt-1 text-2xl font-black text-slate-950">{money(bill.remainingBalance)}</p></div>
              </div>
              <div className="mt-5 grid gap-3 text-sm text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
                <Info label="Total amount" value={money(bill.totalAmount)} />
                <Info label="Approved payments" value={money(bill.approvedAmount)} />
                <Info label="Advance balance" value={money(bill.advanceBalance)} />
                <Info label="Pending review" value={bill.hasPendingPayment ? 'Yes' : 'No'} />
              </div>
              <div className="mt-5 flex justify-end">
                <Link to={`/resident/bills/${bill.id}`} className="resident-soa-button resident-soa-button-green">Open SOA <span aria-hidden="true">→</span></Link>
              </div>
            </article>
          ))}
        </div>
        {bills.length === 0 && <EmptyRow message="No published SOAs are available for your assigned units yet." />}
      </Panel>
    </DashboardLayout>
  )
}

function SummaryCard({ icon: Icon, label, value, accent }) {
  return <div className={`resident-summary-card resident-summary-${accent}`}><div><p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p><p className="mt-2 text-2xl font-black text-slate-950">{value}</p></div><div className="resident-card-icon"><Icon size={19} /></div></div>
}

function Info({ label, value }) {
  return (
    <div className="resident-soa-info rounded-xl p-3">
      <p className="text-xs font-bold uppercase text-slate-400">{label}</p>
      <p className="mt-1 font-semibold text-slate-900">{value}</p>
    </div>
  )
}
