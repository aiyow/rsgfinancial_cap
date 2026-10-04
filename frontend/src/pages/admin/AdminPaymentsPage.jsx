import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { CheckCircle2, ChevronDown, Clock3, WalletCards, XCircle } from 'lucide-react'
import DashboardLayout, { Panel } from '../../components/DashboardLayout'
import NoticeToast from '../../components/NoticeToast'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'
import AdminPaymentQueue from '../../components/AdminPaymentQueue'
import PaymentAllocationPreview from '../../components/PaymentAllocationPreview'
import { purposeLabels } from '../../utils/chargePayments'

const methods = ['GCASH', 'BANK_TRANSFER', 'CASH', 'OTHER']
const inputClass = 'mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm'

function money(value) {
  return `PHP ${Number(value || 0).toFixed(2)}`
}

function methodLabel(value) {
  return value ? value.replace('_', ' ') : 'Not set'
}

export default function AdminPaymentsPage() {
  const location = useLocation()
  const { token } = useAuth()
  const [payments, setPayments] = useState([])
  const [paymentsLoading, setPaymentsLoading] = useState(true)
  const [paymentsError, setPaymentsError] = useState('')
  const [bills, setBills] = useState([])
  const [units, setUnits] = useState([])
  const [credits, setCredits] = useState([])
  const [busy, setBusy] = useState(false)
  const [manualModalOpen, setManualModalOpen] = useState(false)
  const [manualForm, setManualForm] = useState({
    targetType: 'SOA',
    targetBillId: '',
    unitId: '',
    paymentMethod: 'CASH',
    paymentPurpose: 'COMBINED',
    amount: '',
    paymentDate: new Date().toISOString().slice(0, 10),
    referenceNo: '',
    remarks: '',
  })
  const [notice, setNotice] = useState({ error: '', message: location.state?.message || '' })

  useEffect(() => {
    let active = true
    queueMicrotask(() => { if (active) { setPaymentsLoading(true); setPaymentsError('') } })
    apiRequest('/api/payments', { token })
      .then((data) => { if (active) setPayments(data.payments || []) })
      .catch((requestError) => { if (active) { setPayments([]); setPaymentsError(requestError.message) } })
      .finally(() => { if (active) setPaymentsLoading(false) })
    return () => { active = false }
  }, [token])

  useEffect(() => {
    let active = true
    Promise.all([
      apiRequest('/api/bills', { token }),
      apiRequest('/api/units', { token }),
      apiRequest('/api/payments/credits', { token }),
    ])
      .then(([billData, unitData, creditData]) => {
        if (!active) return
        setBills(billData.bills)
        setUnits(unitData.units)
        setCredits(creditData.credits)
        setManualForm((current) => ({
          ...current,
          targetBillId: current.targetBillId || String(billData.bills.find((bill) => bill.paymentStatus !== 'PAID')?.id || billData.bills[0]?.id || ''),
          unitId: current.unitId || String(unitData.units[0]?.id || ''),
        }))
      })
      .catch((requestError) => { if (active) setNotice((current) => ({ ...current, error: requestError.message })) })
    return () => { active = false }
  }, [token])

  const counts = useMemo(() => ({
    total: payments.length,
    pending: payments.filter((payment) => payment.reviewStatus === 'PENDING').length,
    approved: payments.filter((payment) => payment.reviewStatus === 'APPROVED').length,
    rejected: payments.filter((payment) => payment.reviewStatus === 'REJECTED').length,
  }), [payments])

  const selectedBill = useMemo(
    () => bills.find((bill) => String(bill.id) === String(manualForm.targetBillId)),
    [bills, manualForm.targetBillId],
  )
  const selectedUnitId = manualForm.targetType === 'SOA' ? selectedBill?.unitId : manualForm.unitId
  const selectedCredit = credits.find((credit) => String(credit.unitId) === String(selectedUnitId))

  function updateManual(field, value) {
    setManualForm((current) => ({ ...current, [field]: value }))
  }

  async function refreshPayments() {
    const [paymentData, creditData, billData] = await Promise.all([
      apiRequest('/api/payments', { token }),
      apiRequest('/api/payments/credits', { token }),
      apiRequest('/api/bills', { token }),
    ])
    setPayments(paymentData.payments)
    setPaymentsError('')
    setCredits(creditData.credits)
    setBills(billData.bills)
  }

  async function submitManual(event) {
    event.preventDefault()
    setBusy(true)
    setNotice({ error: '', message: '' })
    try {
      const body = {
        paymentMethod: manualForm.paymentMethod,
        paymentPurpose: manualForm.paymentPurpose,
        amount: Number(manualForm.amount),
        paymentDate: manualForm.paymentDate,
        referenceNo: manualForm.referenceNo || undefined,
        remarks: manualForm.remarks || undefined,
        ...(manualForm.targetType === 'SOA'
          ? { targetBillId: Number(manualForm.targetBillId) }
          : { unitId: Number(manualForm.unitId) }),
      }
      const data = await apiRequest('/api/payments/manual', { method: 'POST', token, body })
      await refreshPayments()
      setManualForm((current) => ({ ...current, amount: '', referenceNo: '', remarks: '' }))
      setManualModalOpen(false)
      setNotice({ error: '', message: data.message })
    } catch (error) {
      setNotice({ error: error.message, message: '' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <DashboardLayout title="Resident payment proofs" className="admin-payments-shell" description="Review receipt uploads and record face-to-face payments.">
      <NoticeToast key={notice.error || notice.message || 'empty'} error={notice.error} message={notice.message} />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <StatCard label="Total payments" value={paymentsLoading ? '—' : counts.total} icon={WalletCards} accent="blue" />
        <StatCard label="Pending review" value={paymentsLoading ? '—' : counts.pending} icon={Clock3} accent="yellow" />
        <StatCard label="Approved" value={paymentsLoading ? '—' : counts.approved} icon={CheckCircle2} accent="green" />
        <StatCard label="Rejected" value={paymentsLoading ? '—' : counts.rejected} icon={XCircle} accent="red" />
      </div>

      <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-black text-slate-900">Manual payment</h2>
          <p className="mt-1 text-sm text-slate-500">Record a face-to-face payment or add advance credit when needed.</p>
        </div>
        <button type="button" onClick={() => setManualModalOpen(true)} className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white">Record payment</button>
      </section>

      <Panel className="admin-payments-panel" title="Payment queue" description="Find a payment quickly. Open View Details for receipt, invoice and allocation information.">
        <AdminPaymentQueue payments={payments} loading={paymentsLoading} error={paymentsError} />
      </Panel>

      {manualModalOpen && (
        <ManualPaymentModal
          bills={bills}
          busy={busy}
          form={manualForm}
          methods={methods}
          selectedCredit={selectedCredit}
          units={units}
          onClose={() => setManualModalOpen(false)}
          onSubmit={submitManual}
          onUpdate={updateManual}
        />
      )}
    </DashboardLayout>
  )
}

function ManualPaymentModal({ bills, busy, form, methods: paymentMethods, selectedCredit, units, onClose, onSubmit, onUpdate }) {
  const canSubmit = form.amount && (form.targetType === 'SOA' ? form.targetBillId : form.unitId)
  const [methodMenuOpen, setMethodMenuOpen] = useState(false)
  const [previewKey, setPreviewKey] = useState('')
  const allocationRequest = { ...(form.targetType === 'SOA' ? { targetBillId: Number(form.targetBillId) } : { unitId: Number(form.unitId) }), paymentPurpose: form.paymentPurpose, amount: Number(form.amount || 0), paymentDate: form.paymentDate }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-4" role="presentation" onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="manual-payment-title" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="manual-payment-title" className="text-xl font-black text-slate-900">Record manual payment</h2>
            <p className="mt-1 text-sm text-slate-500">Use this only for payments received outside the resident receipt upload flow.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Close</button>
        </div>

        <form onSubmit={onSubmit} className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => onUpdate('targetType', 'SOA')} className={`payment-filter ${form.targetType === 'SOA' ? 'payment-filter-active' : ''}`}>Apply to SOA</button>
            <button type="button" onClick={() => onUpdate('targetType', 'ADVANCE')} className={`payment-filter ${form.targetType === 'ADVANCE' ? 'payment-filter-active' : ''}`}>Advance Credit</button>
          </div>

          {form.targetType === 'SOA' ? (
            <label className="block text-sm font-bold text-slate-700 sm:col-span-2">
              Statement of Account
              <select required value={form.targetBillId} onChange={(event) => onUpdate('targetBillId', event.target.value)} className={inputClass}>
                {bills.map((bill) => <option key={bill.id} value={bill.id}>Unit {bill.unitNumber} · {String(bill.periodStart).slice(0, 10)} · remaining {money(bill.remainingBalance)}</option>)}
              </select>
            </label>
          ) : (
            <label className="block text-sm font-bold text-slate-700 sm:col-span-2">
              Unit
              <select required value={form.unitId} onChange={(event) => onUpdate('unitId', event.target.value)} className={inputClass}>
                {units.map((unit) => <option key={unit.id} value={unit.id}>Unit {unit.unitNumber}</option>)}
              </select>
            </label>
          )}

          <label className="text-sm font-bold sm:col-span-2">Payment purpose<select required value={form.paymentPurpose} onChange={event => onUpdate('paymentPurpose', event.target.value)} className={inputClass}>{Object.entries(purposeLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <div className="relative block text-sm font-bold text-slate-700">
            <p>Payment method</p>
            <button type="button" aria-expanded={methodMenuOpen} onClick={() => setMethodMenuOpen((current) => !current)} className="mt-1.5 flex h-[42px] w-full min-w-0 items-center justify-between gap-3 overflow-hidden rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm font-normal text-slate-700 outline-none transition hover:border-[#2f8f5b]">
              <span className="min-w-0 truncate">{methodLabel(form.paymentMethod)}</span>
              <ChevronDown size={17} className={`shrink-0 text-slate-500 transition ${methodMenuOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {methodMenuOpen && <div className="absolute inset-x-0 top-[calc(100%+8px)] z-30 max-h-60 overflow-y-auto rounded-xl border border-[#d7eadc] bg-white p-3 shadow-xl"><div className="grid gap-1">{paymentMethods.map((method) => <button key={method} type="button" onClick={() => { onUpdate('paymentMethod', method); setMethodMenuOpen(false) }} className={`rounded-lg px-2.5 py-2 text-left text-xs font-medium transition ${form.paymentMethod === method ? 'bg-[#2f8f5b] text-white' : 'text-[#466653] hover:bg-[#effaf2] hover:text-[#2f8f5b]'}`}>{methodLabel(method)}</button>)}</div></div>}
          </div>
          <label className="block text-sm font-bold text-slate-700">
            Amount
            <input required min="0.01" step="0.01" type="number" value={form.amount} onChange={(event) => onUpdate('amount', event.target.value)} className={inputClass} />
          </label>
          <label className="block text-sm font-bold text-slate-700">
            Payment date
            <input required type="date" value={form.paymentDate} onChange={(event) => onUpdate('paymentDate', event.target.value)} className={inputClass} />
          </label>
          <label className="block text-sm font-bold text-slate-700">
            Bank / GCash transaction reference
            <input value={form.referenceNo} onChange={(event) => onUpdate('referenceNo', event.target.value)} placeholder="Auto-generated if blank" className={inputClass} />
          </label>
          <label className="block text-sm font-bold text-slate-700 sm:col-span-2">
            Remarks <span className="font-normal text-slate-500">(optional)</span>
            <input value={form.remarks} onChange={(event) => onUpdate('remarks', event.target.value)} className={inputClass} />
          </label>

          <div className="rounded-xl bg-slate-50 p-4 sm:col-span-2">
            <p className="text-xs font-bold capitalize text-slate-400">Selected unit advance balance</p>
            <p className="mt-1 text-sm font-bold">Water {money(selectedCredit?.waterAdvance || 0)} · Association {money(selectedCredit?.associationAdvance || 0)}</p>
          </div>
          <PaymentAllocationPreview request={allocationRequest} onReady={setPreviewKey} />
          <div className="flex justify-end gap-3 sm:col-span-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium">Cancel</button>
            <button disabled={busy || !canSubmit || previewKey !== JSON.stringify(allocationRequest)} className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white disabled:bg-slate-300">{busy ? 'Recording...' : 'Record payment'}</button>
          </div>
        </form>
      </section>
    </div>
  )
}

function StatCard({ accent, icon: Icon, label, value }) {
  return (
    <div className={`collector-metric collector-metric-${accent} rounded-xl border border-[var(--border)] p-3.5 shadow-sm`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-[var(--muted)]">{label}</p>
          <p className="mt-1 text-2xl font-black text-[var(--ink)]">{value}</p>
        </div>
        <span className="grid size-11 place-items-center rounded-xl">
          <Icon size={21} />
        </span>
      </div>
    </div>
  )
}
