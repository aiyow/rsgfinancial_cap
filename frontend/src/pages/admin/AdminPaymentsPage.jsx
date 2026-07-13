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

      <Panel title="Record face-to-face payment" description="Create an approved cash, GCash, bank transfer, or advance payment for a unit.">
        <form onSubmit={submitManual} className="grid gap-4 lg:grid-cols-4">
          <div className="lg:col-span-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => updateManual('targetType', 'SOA')} className={`rounded-full px-4 py-2 text-sm font-bold ${manualForm.targetType === 'SOA' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>Apply to SOA</button>
            <button type="button" onClick={() => updateManual('targetType', 'ADVANCE')} className={`rounded-full px-4 py-2 text-sm font-bold ${manualForm.targetType === 'ADVANCE' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>Advance balance</button>
          </div>

          {manualForm.targetType === 'SOA' ? (
            <label className="block text-sm font-bold text-slate-700 lg:col-span-2">
              Statement of Account
              <select required value={manualForm.targetBillId} onChange={(event) => updateManual('targetBillId', event.target.value)} className={inputClass}>
                {bills.map((bill) => (
                  <option key={bill.id} value={bill.id}>Unit {bill.unitNumber} - {String(bill.periodStart).slice(0, 10)} - remaining {money(bill.remainingBalance)}</option>
                ))}
              </select>
            </label>
          ) : (
            <label className="block text-sm font-bold text-slate-700 lg:col-span-2">
              Unit
              <select required value={manualForm.unitId} onChange={(event) => updateManual('unitId', event.target.value)} className={inputClass}>
                {units.map((unit) => <option key={unit.id} value={unit.id}>Unit {unit.unitNumber}</option>)}
              </select>
            </label>
          )}

          <label className="block text-sm font-bold text-slate-700">
            Payment method
            <select value={manualForm.paymentMethod} onChange={(event) => updateManual('paymentMethod', event.target.value)} className={inputClass}>
              {methods.map((method) => <option key={method} value={method}>{methodLabel(method)}</option>)}
            </select>
          </label>

          <label className="block text-sm font-bold text-slate-700">
            Amount
            <input required min="0.01" step="0.01" type="number" value={manualForm.amount} onChange={(event) => updateManual('amount', event.target.value)} className={inputClass} />
          </label>

          <label className="block text-sm font-bold text-slate-700">
            Payment date
            <input required type="date" value={manualForm.paymentDate} onChange={(event) => updateManual('paymentDate', event.target.value)} className={inputClass} />
          </label>

          <label className="block text-sm font-bold text-slate-700">
            Reference / OR no.
            <input value={manualForm.referenceNo} onChange={(event) => updateManual('referenceNo', event.target.value)} placeholder="Auto-generated if blank" className={inputClass} />
          </label>

          <label className="block text-sm font-bold text-slate-700 lg:col-span-2">
            Remarks
            <input value={manualForm.remarks} onChange={(event) => updateManual('remarks', event.target.value)} className={inputClass} />
          </label>

          <div className="rounded-xl bg-slate-50 p-4 text-sm lg:col-span-2">
            <p className="text-xs font-bold uppercase text-slate-400">Selected unit advance balance</p>
            <p className="mt-2 text-2xl font-black text-slate-950">{money(selectedCredit?.advanceBalance || 0)}</p>
          </div>

          <div className="lg:col-span-4">
            <button disabled={busy || !manualForm.amount || (manualForm.targetType === 'SOA' ? !manualForm.targetBillId : !manualForm.unitId)} className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white disabled:bg-slate-300">
              {busy ? 'Recording payment...' : 'Record payment'}
            </button>
          </div>
        </form>
      </Panel>

      <Panel title="Payment queue" description="Open a payment proof to inspect the receipt or view finalized manual payments.">
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
            <table className="w-full min-w-[1180px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr>
                  <th className="pb-3">Unit</th>
                  <th>Resident</th>
                  <th>Submitted</th>
                  <th>OCR amount</th>
                  <th>Verified amount</th>
                  <th>Method / source</th>
                  <th>Applied / advance</th>
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
                      <p className="text-xs text-slate-500">Due {String(payment.dueDate || '').slice(0, 10) || '-'}</p>
                    </td>
                    <td>{dateTime(payment.submittedAt)}</td>
                    <td>{payment.ocrAmount ? money(payment.ocrAmount) : 'Not detected'}</td>
                    <td>{payment.verifiedAmount ? money(payment.verifiedAmount) : '-'}</td>
                    <td>
                      <p className="font-semibold text-slate-800">{methodLabel(payment.paymentMethod)}</p>
                      <p className="text-xs text-slate-500">{payment.entryType === 'MANUAL' ? 'Manual entry' : 'Receipt upload'}</p>
                    </td>
                    <td>
                      <p>{money(payment.appliedAmount)}</p>
                      <p className="text-xs text-slate-500">Advance {money(payment.unitAdvanceBalance)}</p>
                    </td>
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
