import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

const statuses = ['ALL', 'PENDING', 'APPROVED', 'REJECTED']
const methods = ['GCASH', 'BANK_TRANSFER', 'CASH', 'OTHER']
const inputClass = 'mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm'
const badgeClass = {
  PENDING: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-emerald-50 text-emerald-700',
  REJECTED: 'bg-rose-50 text-rose-700',
}

function money(value) {
  return `PHP ${Number(value || 0).toFixed(2)}`
}

function dateTime(value) {
  return value ? new Date(value).toLocaleString() : '-'
}

function methodLabel(value) {
  return value ? value.replace('_', ' ') : 'Not set'
}

export default function AdminPaymentsPage() {
  const location = useLocation()
  const { token } = useAuth()
  const [status, setStatus] = useState('ALL')
  const [payments, setPayments] = useState([])
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
    amount: '',
    paymentDate: new Date().toISOString().slice(0, 10),
    referenceNo: '',
    remarks: '',
  })
  const [notice, setNotice] = useState({ error: '', message: location.state?.message || '' })

  useEffect(() => {
    let active = true
    const query = status === 'ALL' ? '' : `?status=${status}`
    apiRequest(`/api/payments${query}`, { token })
      .then((data) => { if (active) setPayments(data.payments) })
      .catch((requestError) => { if (active) setNotice((current) => ({ ...current, error: requestError.message })) })
    return () => { active = false }
  }, [status, token])

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
    const query = status === 'ALL' ? '' : `?status=${status}`
    const [paymentData, creditData, billData] = await Promise.all([
      apiRequest(`/api/payments${query}`, { token }),
      apiRequest('/api/payments/credits', { token }),
      apiRequest('/api/bills', { token }),
    ])
    setPayments(paymentData.payments)
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
    <DashboardLayout title="Resident payment proofs" description="Review receipt uploads and record face-to-face payments.">
      {(notice.error || notice.message) && <p className={`rounded-lg p-3 text-sm ${notice.error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{notice.error || notice.message}</p>}

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Loaded payments" value={counts.total} />
        <StatCard label="Pending review" value={counts.pending} accent="amber" />
        <StatCard label="Approved" value={counts.approved} accent="emerald" />
        <StatCard label="Rejected" value={counts.rejected} accent="rose" />
      </div>

      <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <h2 className="text-lg font-black text-slate-900">Manual payment</h2>
          <p className="mt-1 text-sm text-slate-500">Record a face-to-face payment or add advance credit when needed.</p>
        </div>
        <button type="button" onClick={() => setManualModalOpen(true)} className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white">Record payment</button>
      </section>

      <Panel title="Payment queue" description="Review the essentials here, then open a payment for its receipt, OCR, and full details.">
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
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr>
                  <th className="pb-3">Resident / unit</th>
                  <th>Received</th>
                  <th>Amount</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td className="py-3">
                      <p className="font-semibold text-slate-800">{payment.submittedByName}</p>
                      <p className="text-xs text-slate-500">Unit {payment.unitNumber}</p>
                    </td>
                    <td>{dateTime(payment.submittedAt)}</td>
                    <td>
                      <p className="font-semibold text-slate-800">{payment.reviewStatus === 'APPROVED' ? money(payment.verifiedAmount) : payment.ocrAmount ? money(payment.ocrAmount) : 'Not detected'}</p>
                      <p className="text-xs text-slate-500">{payment.reviewStatus === 'APPROVED' ? 'Verified' : 'OCR estimate'}</p>
                    </td>
                    <td>
                      <p className="font-semibold text-slate-800">{payment.entryType === 'MANUAL' ? 'Manual entry' : 'Receipt upload'}</p>
                      <p className="text-xs text-slate-500">{methodLabel(payment.paymentMethod)}</p>
                    </td>
                    <td><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${badgeClass[payment.reviewStatus]}`}>{payment.reviewStatus}</span></td>
                    <td><Link to={`/admin/payments/${payment.id}`} className="font-bold text-indigo-600">{payment.reviewStatus === 'PENDING' ? 'Review' : 'View details'}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {payments.length === 0 && <EmptyRow message="No payment submissions match the current filter." />}
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

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-4" role="presentation" onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="manual-payment-title" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="manual-payment-title" className="text-xl font-black text-slate-900">Record manual payment</h2>
            <p className="mt-1 text-sm text-slate-500">Use this only for payments received outside the resident receipt upload flow.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100">Close</button>
        </div>

        <form onSubmit={onSubmit} className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => onUpdate('targetType', 'SOA')} className={`rounded-full px-4 py-2 text-sm font-bold ${form.targetType === 'SOA' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>Apply to SOA</button>
            <button type="button" onClick={() => onUpdate('targetType', 'ADVANCE')} className={`rounded-full px-4 py-2 text-sm font-bold ${form.targetType === 'ADVANCE' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>Advance credit</button>
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

          <label className="block text-sm font-bold text-slate-700">
            Payment method
            <select value={form.paymentMethod} onChange={(event) => onUpdate('paymentMethod', event.target.value)} className={inputClass}>
              {paymentMethods.map((method) => <option key={method} value={method}>{methodLabel(method)}</option>)}
            </select>
          </label>
          <label className="block text-sm font-bold text-slate-700">
            Amount
            <input required min="0.01" step="0.01" type="number" value={form.amount} onChange={(event) => onUpdate('amount', event.target.value)} className={inputClass} />
          </label>
          <label className="block text-sm font-bold text-slate-700">
            Payment date
            <input required type="date" value={form.paymentDate} onChange={(event) => onUpdate('paymentDate', event.target.value)} className={inputClass} />
          </label>
          <label className="block text-sm font-bold text-slate-700">
            Reference / OR no.
            <input value={form.referenceNo} onChange={(event) => onUpdate('referenceNo', event.target.value)} placeholder="Auto-generated if blank" className={inputClass} />
          </label>
          <label className="block text-sm font-bold text-slate-700 sm:col-span-2">
            Remarks <span className="font-normal text-slate-500">(optional)</span>
            <input value={form.remarks} onChange={(event) => onUpdate('remarks', event.target.value)} className={inputClass} />
          </label>

          <div className="rounded-xl bg-slate-50 p-4 sm:col-span-2">
            <p className="text-xs font-bold uppercase text-slate-400">Selected unit advance balance</p>
            <p className="mt-1 text-2xl font-black text-slate-950">{money(selectedCredit?.advanceBalance || 0)}</p>
          </div>
          <div className="flex justify-end gap-3 sm:col-span-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold">Cancel</button>
            <button disabled={busy || !canSubmit} className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white disabled:bg-slate-300">{busy ? 'Recording...' : 'Record payment'}</button>
          </div>
        </form>
      </section>
    </div>
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
