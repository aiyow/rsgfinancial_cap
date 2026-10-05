import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BadgeCheck, CircleDollarSign, FileText, WalletCards, X } from 'lucide-react'
import DashboardLayout, { Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'
import AdminPaymentQueue from '../../components/AdminPaymentQueue'
import PaymentAllocationDetails from '../../components/PaymentAllocationDetails'
import { currency } from '../../utils/chargePayments'
import { paymentDateLabel, paymentMethodLabel } from '../../utils/paymentHistory'

export default function CollectorPaymentsPage() {
  const { token } = useAuth()
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedPaymentId, setSelectedPaymentId] = useState(null)

  useEffect(() => {
    let active = true
    queueMicrotask(() => { if (active) { setLoading(true); setError('') } })
    apiRequest('/api/payments?status=APPROVED', { token })
      .then((data) => { if (active) setPayments(data.payments || []) })
      .catch((requestError) => { if (active) { setPayments([]); setError(requestError.message) } })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token])

  const summary = useMemo(() => ({
    approvals: payments.length,
    collected: payments.reduce((sum, payment) => sum + Number(payment.verifiedAmount || 0), 0),
    paidBills: new Set(payments.filter((payment) => payment.paymentStatus === 'PAID' && payment.targetBillId).map((payment) => payment.targetBillId)).size,
  }), [payments])
  const selectedPayment = payments.find((payment) => payment.id === selectedPaymentId)

  return (
    <DashboardLayout title="Verified payment records" className="collector-payments-shell" description="View Admin-approved payments and edit staff-issued invoice references.">
      <div className="grid gap-3 md:grid-cols-3">
        <SummaryCard label="Approved payments" value={loading ? '—' : summary.approvals} icon={WalletCards} accent="blue" />
        <SummaryCard label="Approved amount" value={loading ? '—' : currency(summary.collected)} icon={CircleDollarSign} accent="green" />
        <SummaryCard label="Fully paid SOAs" value={loading ? '—' : summary.paidBills} icon={BadgeCheck} accent="red" />
      </div>

      <Panel className="collector-payments-panel" title="Approved records" description="Find a payment quickly. Open View Details for allocations, invoice references and the SOA.">
        <AdminPaymentQueue payments={payments} loading={loading} error={error} approvedOnly onViewDetails={(payment) => setSelectedPaymentId(payment.id)} />
      </Panel>

      {selectedPayment && <PaymentDetailsDialog payment={selectedPayment} onClose={() => setSelectedPaymentId(null)} />}
    </DashboardLayout>
  )
}

function PaymentDetailsDialog({ payment, onClose }) {
  const dialogRef = useRef(null)

  useEffect(() => {
    const dialog = dialogRef.current
    dialog.showModal()
    return () => { dialog.close() }
  }, [])

  return (
    <dialog ref={dialogRef} onCancel={(event) => { event.preventDefault(); onClose() }} aria-labelledby="collector-payment-details-title" className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-xl backdrop:bg-slate-950/35 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="collector-payment-details-title" className="text-lg font-black">Payment details</h2>
          <p className="mt-1 break-words text-sm text-slate-500">{payment.submittedByName || 'Unknown resident'} · Unit {payment.unitNumber || '—'}</p>
        </div>
        <button type="button" autoFocus onClick={onClose} aria-label="Close payment details" className="grid size-11 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><X size={18} /></button>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-4 rounded-xl bg-slate-50 p-4 sm:grid-cols-3">
        <PaymentDetail label="Approved amount" value={currency(payment.verifiedAmount)} />
        <PaymentDetail label="Applied amount" value={currency(payment.appliedAmount)} />
        <PaymentDetail label="SOA status" value={payment.paymentStatus || '—'} />
        <PaymentDetail label="Paid on" value={paymentDateLabel(payment.verifiedPaymentDate)} />
        <PaymentDetail label="Payment method" value={paymentMethodLabel(payment.paymentMethod)} />
        <PaymentDetail label="Source" value={payment.entryType === 'MANUAL' ? 'Manual entry' : 'Receipt upload'} />
      </dl>

      <section className="mt-5 border-t border-slate-100 pt-4">
        <h3 className="mb-2 text-sm font-black">Payment allocations</h3>
        <PaymentAllocationDetails payment={payment} />
      </section>
      {payment.targetBillId && <p className="mt-4 text-xs text-slate-500">Open the SOA to review the statement and add invoice numbers.</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
        <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-slate-200 px-4 text-xs font-bold text-slate-600">Close</button>
        {payment.targetBillId && <Link to={`/collector/bills/${payment.targetBillId}?from=payments`} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 text-xs font-bold text-emerald-800 hover:bg-emerald-100"><FileText size={14} aria-hidden="true" />Open SOA</Link>}
      </div>
    </dialog>
  )
}

function PaymentDetail({ label, value }) {
  return <div className="min-w-0"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm font-bold">{value}</dd></div>
}

function SummaryCard({ accent, icon: Icon, label, value }) {
  return (
    <div className={`collector-metric collector-metric-${accent} min-w-0 rounded-xl border border-[var(--border)] p-3.5 shadow-sm`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold text-[var(--muted)]">{label}</p>
          <p className="mt-1 break-words text-2xl font-black text-[var(--ink)]">{value}</p>
        </div>
        <span className="grid size-11 shrink-0 place-items-center rounded-xl">
          <Icon size={21} />
        </span>
      </div>
    </div>
  )
}
