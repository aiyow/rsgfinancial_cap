import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import DashboardLayout, { Panel } from '../../components/DashboardLayout'
import NoticeToast from '../../components/NoticeToast'
import SoaDocument from '../../components/SoaDocument'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

const inputClass = 'mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal'
const actionClass = 'rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50'
const dateValue = (value) => value ? String(value).slice(0, 10) : ''

function Field({ label, children }) {
  return <label className="block text-xs font-bold text-slate-600">{label}{children}</label>
}

function formFromBill(bill) {
  return {
    payerName: bill.payerName || '', payerEmail: bill.payerEmail || '',
    periodStart: dateValue(bill.periodStart), periodEnd: dateValue(bill.periodEnd),
    statementDate: dateValue(bill.statementDate), dueDate: dateValue(bill.dueDate),
    previousReading: bill.previousReading ?? '', currentReading: bill.currentReading ?? '',
    reason: '', charges: bill.charges.map((charge) => ({
      id: charge.id, chargeType: charge.chargeType, description: charge.description,
      quantity: charge.quantity, rateApplied: charge.rateApplied,
    })),
  }
}

export default function CollectorBillPage() {
  const { id } = useParams()
  const location = useLocation()
  const { token } = useAuth()
  const [bill, setBill] = useState(null)
  const [form, setForm] = useState(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState({ error: '', message: '' })
  const [references, setReferences] = useState({ invoiceNumber: '', paymentNote: '' })

  useEffect(() => {
    apiRequest(`/api/bills/${id}`, { token })
      .then((data) => { setBill(data.bill); setForm(formFromBill(data.bill)); setReferences({ invoiceNumber: data.bill.invoiceNumber || '', paymentNote: data.bill.paymentNote || '' }) })
      .catch((error) => setNotice({ error: error.message, message: '' }))
  }, [id, token])

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function updateCharge(index, field, value) {
    setForm((current) => ({ ...current, charges: current.charges.map((charge, chargeIndex) => chargeIndex === index ? { ...charge, [field]: value } : charge) }))
  }

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setNotice({ error: '', message: '' })
    try {
      const hasPrevious = form.previousReading !== ''
      const hasCurrent = form.currentReading !== ''
      if (hasPrevious !== hasCurrent) throw new Error('Enter both previous and current readings, or leave both blank.')
      const charges = form.charges.map((charge) => ({
        id: charge.id, description: charge.description, rateApplied: Number(charge.rateApplied),
        ...(charge.chargeType === 'WATER' ? {} : { quantity: Number(charge.quantity) }),
      }))
      const body = { ...form, ...(hasBillingErrorContext ? { billingErrorReportId } : {}), charges }
      if (hasPrevious && hasCurrent) {
        body.previousReading = Number(form.previousReading)
        body.currentReading = Number(form.currentReading)
      } else {
        delete body.previousReading
        delete body.currentReading
      }
      const data = await apiRequest(`/api/bills/${id}`, {
        method: 'PATCH', token,
        body,
      })
      setBill(data.bill)
      setForm(formFromBill(data.bill))
      setEditing(false)
      setNotice({ error: '', message: 'Invoice details and payment note are now up to date.' })
    } catch (error) {
      setNotice({ error: error.message, message: '' })
    } finally { setBusy(false) }
  }

  async function saveReferences(event) {
    event.preventDefault()
    setBusy(true)
    setNotice({ error: '', message: '' })
    try {
      const data = await apiRequest(`/api/bills/${id}/payment-references`, { method: 'PATCH', token, body: { invoiceNumber: references.invoiceNumber || null, paymentNote: references.paymentNote || null } })
      setBill(data.bill)
      setReferences({ invoiceNumber: data.bill.invoiceNumber || '', paymentNote: data.bill.paymentNote || '' })
      setNotice({ error: '', message: data.message })
    } catch (error) { setNotice({ error: error.message, message: '' }) } finally { setBusy(false) }
  }

  const openedFromBillingErrors = new URLSearchParams(location.search).get('from') === 'billing-errors'
  const billingErrorReportId = Number(new URLSearchParams(location.search).get('reportId'))
  const hasBillingErrorContext = openedFromBillingErrors && Number.isSafeInteger(billingErrorReportId) && billingErrorReportId > 0
  const correctionBlockedReason = bill && Number(bill.approvedAmount || 0) > 0
    ? 'This SOA has an approved payment, so billing amounts are protected. You can still add its invoice number or payment note below.'
    : bill?.hasPendingPayment
      ? 'This SOA has a payment awaiting review, so billing amounts are temporarily protected until the payment is reviewed.'
      : ''
  const canCorrect = Boolean(bill && ['GENERATED', 'FORWARDED', 'CLOSED'].includes(bill.status) && (!correctionBlockedReason || hasBillingErrorContext))

  return (
    <DashboardLayout title="Statement of Account" description="Review, correct, and print the generated statement.">
      <div className="print-hidden flex flex-wrap gap-3"><Link to={openedFromBillingErrors ? '/collector/billing-errors' : '/collector/bills'} className={actionClass}>{openedFromBillingErrors ? 'Back to Billing Errors' : 'Back to batches'}</Link><button onClick={() => window.print()} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white">Print / Save PDF</button>{canCorrect && <button disabled={busy} onClick={() => setEditing((value) => !value)} className="rounded-lg border border-emerald-600 bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{editing ? 'Cancel correction' : openedFromBillingErrors ? 'Correct reported SOA' : 'Correct SOA'}</button>}</div>
      <NoticeToast key={notice.error || notice.message || 'empty'} error={notice.error} message={notice.message} />
      {openedFromBillingErrors && correctionBlockedReason && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{hasBillingErrorContext ? 'This SOA has payment activity. Because it was opened from an active Billing Error report, you may correct all SOA details. The system will preserve the payment record and recalculate its applications and remaining balance.' : correctionBlockedReason}</p>}
      {editing && form && <Panel title="Edit SOA" description="Changes affect only this statement and are recorded in the billing audit history.">
        <form onSubmit={save} className="space-y-5">
          <div className="grid gap-3 md:grid-cols-4"><Field label="Payer name"><input value={form.payerName} onChange={(event) => update('payerName', event.target.value)} className={inputClass} /></Field><Field label="Payer email"><input type="email" value={form.payerEmail} onChange={(event) => update('payerEmail', event.target.value)} className={inputClass} /></Field><Field label="Statement date"><input required type="date" value={form.statementDate} onChange={(event) => update('statementDate', event.target.value)} className={inputClass} /></Field><Field label="Due date"><input required type="date" value={form.dueDate} onChange={(event) => update('dueDate', event.target.value)} className={inputClass} /></Field></div>
          <div className="grid gap-3 md:grid-cols-4"><Field label="Period start"><input required type="date" value={form.periodStart} onChange={(event) => update('periodStart', event.target.value)} className={inputClass} /></Field><Field label="Period end"><input required type="date" value={form.periodEnd} onChange={(event) => update('periodEnd', event.target.value)} className={inputClass} /></Field><Field label="Previous reading"><input min="0" step="0.001" type="number" value={form.previousReading} onChange={(event) => update('previousReading', event.target.value)} className={inputClass} /></Field><Field label="Current reading"><input min="0" step="0.001" type="number" value={form.currentReading} onChange={(event) => update('currentReading', event.target.value)} className={inputClass} /></Field></div>
          <div className="space-y-3">{form.charges.map((charge, index) => <div key={charge.id} className="grid gap-3 rounded-xl bg-slate-50 p-4 md:grid-cols-4"><Field label={`${charge.chargeType} description`}><input required value={charge.description} onChange={(event) => updateCharge(index, 'description', event.target.value)} className={inputClass} /></Field><Field label="Quantity"><input disabled={charge.chargeType === 'WATER'} required min="0" step="0.001" type="number" value={charge.quantity} onChange={(event) => updateCharge(index, 'quantity', event.target.value)} className={`${inputClass} disabled:bg-slate-100`} /></Field><Field label="Rate"><input required min="0" step="0.01" type="number" value={charge.rateApplied} onChange={(event) => updateCharge(index, 'rateApplied', event.target.value)} className={inputClass} /></Field></div>)}</div>
          <Field label="Reason for correction"><textarea required minLength="3" value={form.reason} onChange={(event) => update('reason', event.target.value)} className={`${inputClass} min-h-24`} /></Field>
          <button disabled={busy} className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white disabled:bg-slate-300">Save corrected SOA</button>
        </form>
      </Panel>}
      {bill && Number(bill.approvedAmount || 0) > 0 && <Panel title="Invoice details" description="Invoice details remain editable after payment approval; billing amounts remain protected."><form onSubmit={saveReferences} className="grid gap-4 md:grid-cols-2"><Field label="Invoice number"><input value={references.invoiceNumber} onChange={(event) => setReferences((current) => ({ ...current, invoiceNumber: event.target.value }))} className={inputClass} /></Field><div className="md:col-span-2"><Field label="Payment note"><textarea value={references.paymentNote} onChange={(event) => setReferences((current) => ({ ...current, paymentNote: event.target.value }))} className={`${inputClass} min-h-20`} /></Field></div><button disabled={busy} className="w-fit rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Save invoice details</button></form></Panel>}
      {!bill && !notice.error && <p className="text-sm text-slate-500">Loading statement...</p>}
      {bill && <SoaDocument bill={bill} />}
    </DashboardLayout>
  )
}
