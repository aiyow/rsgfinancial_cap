import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import DashboardLayout, { Panel } from '../../components/DashboardLayout'
import NoticeToast from '../../components/NoticeToast'
import SoaDocument from '../../components/SoaDocument'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

function emailSummaryMessage(summary) {
  if (!summary) return ''
  const parts = []
  if (summary.sent) parts.push(`${summary.sent} email${summary.sent === 1 ? '' : 's'} sent`)
  if (summary.failed) parts.push(`${summary.failed} failed`)
  if (summary.skipped) parts.push(`${summary.skipped} SOA${summary.skipped === 1 ? '' : 's'} had no active email recipient`)
  return parts.length ? ` Email delivery: ${parts.join(', ')}.` : ''
}

const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm'
const dateValue = (value) => value ? String(value).slice(0, 10) : ''
function correctionFromBill(bill) {
  return { payerName: bill.payerName || '', payerEmail: bill.payerEmail || '', periodStart: dateValue(bill.periodStart), periodEnd: dateValue(bill.periodEnd), statementDate: dateValue(bill.statementDate), dueDate: dateValue(bill.dueDate), previousReading: bill.previousReading ?? '', currentReading: bill.currentReading ?? '', reason: '', charges: bill.charges.map((charge) => ({ id: charge.id, chargeType: charge.chargeType, description: charge.description, quantity: charge.quantity, rateApplied: charge.rateApplied })) }
}

export default function AdminSoaBillPage() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { token } = useAuth()
  const [bill, setBill] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState({ error: '', message: '' })
  const soaRef = useRef(null)
  const [editing, setEditing] = useState(false)
  const [correction, setCorrection] = useState(null)
  const [references, setReferences] = useState({ officialReceiptNumber: '', invoiceNumber: '', paymentNote: '' })

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const data = await apiRequest(`/api/bills/${id}`, { token })
        if (active) { setBill(data.bill); setCorrection(correctionFromBill(data.bill)); setReferences({ officialReceiptNumber: data.bill.officialReceiptNumber || '', invoiceNumber: data.bill.invoiceNumber || '', paymentNote: data.bill.paymentNote || '' }) }
      } catch (requestError) {
        if (active) setNotice({ error: requestError.message, message: '' })
      }
    }
    load()
    return () => { active = false }
  }, [id, token])

  async function publishBill() {
    if (!bill) return
    setBusy(true)
    setNotice({ error: '', message: '' })
    try {
      const data = await apiRequest(`/api/billing-periods/${bill.billingPeriodId}/publish`, {
        method: 'POST',
        token,
        body: { billIds: [bill.id] },
      })
      const refreshed = await apiRequest(`/api/bills/${id}`, { token })
      setBill(refreshed.bill)
      setNotice({ error: '', message: `${data.message}${emailSummaryMessage(data.emailSummary)}` })
    } catch (error) {
      setNotice({ error: error.message, message: '' })
    } finally {
      setBusy(false)
    }
  }

  async function retryEmails() {
    if (!bill) return
    setBusy(true)
    setNotice({ error: '', message: '' })
    try {
      const data = await apiRequest(`/api/billing-periods/${bill.billingPeriodId}/bills/${bill.id}/email-deliveries/retry`, { method: 'POST', token })
      const refreshed = await apiRequest(`/api/bills/${id}`, { token })
      setBill(refreshed.bill)
      setNotice({ error: '', message: `${data.message}${emailSummaryMessage(data.emailSummary)}` })
    } catch (error) {
      setNotice({ error: error.message, message: '' })
    } finally {
      setBusy(false)
    }
  }

  async function resendEmails() {
    if (!bill || !window.confirm(`Resend the SOA for Unit ${bill.unitNumber} to all saved recipients?`)) return
    setBusy(true)
    setNotice({ error: '', message: '' })
    try {
      const data = await apiRequest(`/api/billing-periods/${bill.billingPeriodId}/bills/${bill.id}/email-deliveries/resend`, { method: 'POST', token })
      const refreshed = await apiRequest(`/api/bills/${id}`, { token })
      setBill(refreshed.bill)
      setNotice({ error: '', message: `${data.message}${emailSummaryMessage(data.emailSummary)}` })
    } catch (error) {
      setNotice({ error: error.message, message: '' })
    } finally {
      setBusy(false)
    }
  }

  async function saveCorrection(event) {
    event.preventDefault()
    setBusy(true); setNotice({ error: '', message: '' })
    try {
      const body = { ...correction, ...(hasBillingErrorContext ? { billingErrorReportId } : {}), charges: correction.charges.map((charge) => ({ id: charge.id, description: charge.description, rateApplied: Number(charge.rateApplied), ...(charge.chargeType === 'WATER' ? {} : { quantity: Number(charge.quantity) }) })) }
      if (body.previousReading !== '' && body.currentReading !== '') { body.previousReading = Number(body.previousReading); body.currentReading = Number(body.currentReading) } else { delete body.previousReading; delete body.currentReading }
      const data = await apiRequest(`/api/bills/${id}`, { method: 'PATCH', token, body })
      setBill(data.bill); setCorrection(correctionFromBill(data.bill)); setEditing(false)
      setNotice({ error: '', message: `${data.message}${emailSummaryMessage(data.emailSummary)}` })
    } catch (error) { setNotice({ error: error.message, message: '' }) } finally { setBusy(false) }
  }

  async function saveReferences(event) {
    event.preventDefault()
    setBusy(true); setNotice({ error: '', message: '' })
    try {
      const data = await apiRequest(`/api/bills/${id}/payment-references`, { method: 'PATCH', token, body: { officialReceiptNumber: references.officialReceiptNumber || null, invoiceNumber: references.invoiceNumber || null, paymentNote: references.paymentNote || null } })
      setBill(data.bill); setReferences({ officialReceiptNumber: data.bill.officialReceiptNumber || '', invoiceNumber: data.bill.invoiceNumber || '', paymentNote: data.bill.paymentNote || '' }); setNotice({ error: '', message: 'Payment references saved. The official receipt, invoice number, and payment note are now up to date.' })
      soaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch (error) { setNotice({ error: error.message, message: '' }) } finally { setBusy(false) }
  }

  function updateCorrection(field, value) { setCorrection((current) => ({ ...current, [field]: value })) }
  function updateCharge(index, field, value) { setCorrection((current) => ({ ...current, charges: current.charges.map((charge, chargeIndex) => chargeIndex === index ? { ...charge, [field]: value } : charge) })) }

  const openedFromBillingErrors = new URLSearchParams(location.search).get('from') === 'billing-errors'
  const billingErrorReportId = Number(new URLSearchParams(location.search).get('reportId'))
  const hasBillingErrorContext = openedFromBillingErrors && Number.isSafeInteger(billingErrorReportId) && billingErrorReportId > 0
  const correctionBlockedReason = bill && Number(bill.approvedAmount || 0) > 0
    ? 'This SOA has an approved payment, so billing amounts are protected. You can still add its Official Receipt, invoice number, or payment note below.'
    : bill?.hasPendingPayment
      ? 'This SOA has a payment awaiting review, so billing amounts are temporarily protected until the payment is reviewed.'
      : ''
  const canCorrect = Boolean(bill && ['GENERATED', 'FORWARDED', 'CLOSED'].includes(bill.status) && (!correctionBlockedReason || hasBillingErrorContext))

  return (
    <DashboardLayout title="Forwarded Statement of Account" description={openedFromBillingErrors ? 'Review the reported SOA, make any permitted correction, then return to Billing Errors.' : 'Review, correct, or publish this forwarded SOA.'}>
      <div className="print-hidden flex flex-wrap gap-3"><button type="button" onClick={() => navigate(-1)} className="rounded-lg border border-emerald-300 bg-white px-4 py-2 text-sm font-bold text-emerald-800 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-700 hover:bg-emerald-700 hover:text-white hover:shadow-md">Go back</button><button onClick={() => window.print()} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white">Print / Save PDF</button>{bill && !bill.publishedAt && <button disabled={busy} onClick={publishBill} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold disabled:opacity-50">Publish this SOA</button>}{canCorrect && <button disabled={busy} onClick={() => setEditing((value) => !value)} className="rounded-lg border border-emerald-600 bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{editing ? 'Cancel correction' : openedFromBillingErrors ? 'Correct reported SOA' : 'Correct SOA'}</button>}{bill && Number(bill.emailDelivery?.failed || 0) > 0 && <button disabled={busy} onClick={retryEmails} className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-bold text-rose-700 disabled:opacity-50">Retry failed email{Number(bill.emailDelivery.failed) === 1 ? '' : 's'}</button>}{bill && (Number(bill.emailDelivery?.sent || 0) + Number(bill.emailDelivery?.failed || 0)) > 0 && <button disabled={busy} onClick={resendEmails} className="rounded-lg border border-indigo-300 px-4 py-2 text-sm font-bold text-indigo-700 disabled:opacity-50">Resend SOA email</button>}</div>
      <NoticeToast key={notice.error || notice.message || 'empty'} error={notice.error} message={notice.message} />
      {!bill && !notice.error && <p className="text-sm text-slate-500">Loading statement...</p>}
      {openedFromBillingErrors && correctionBlockedReason && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{hasBillingErrorContext ? 'This SOA has payment activity. Because it was opened from an active Billing Error report, you may correct all SOA details. The system will preserve the payment record and recalculate its applications and remaining balance.' : correctionBlockedReason}</p>}
      {editing && correction && <Panel title="Correct SOA" description="Correct an unpaid SOA. Published corrections are automatically reissued to residents."><form onSubmit={saveCorrection} className="space-y-4"><div className="grid gap-3 md:grid-cols-4"><label className="text-xs font-bold">Payer name<input value={correction.payerName} onChange={(event) => updateCorrection('payerName', event.target.value)} className={inputClass} /></label><label className="text-xs font-bold">Payer email<input value={correction.payerEmail} onChange={(event) => updateCorrection('payerEmail', event.target.value)} className={inputClass} /></label><label className="text-xs font-bold">Statement date<input type="date" value={correction.statementDate} onChange={(event) => updateCorrection('statementDate', event.target.value)} className={inputClass} /></label><label className="text-xs font-bold">Due date<input type="date" value={correction.dueDate} onChange={(event) => updateCorrection('dueDate', event.target.value)} className={inputClass} /></label><label className="text-xs font-bold">Period start<input type="date" value={correction.periodStart} onChange={(event) => updateCorrection('periodStart', event.target.value)} className={inputClass} /></label><label className="text-xs font-bold">Period end<input type="date" value={correction.periodEnd} onChange={(event) => updateCorrection('periodEnd', event.target.value)} className={inputClass} /></label><label className="text-xs font-bold">Previous reading<input type="number" min="0" step="0.001" value={correction.previousReading} onChange={(event) => updateCorrection('previousReading', event.target.value)} className={inputClass} /></label><label className="text-xs font-bold">Current reading<input type="number" min="0" step="0.001" value={correction.currentReading} onChange={(event) => updateCorrection('currentReading', event.target.value)} className={inputClass} /></label></div><div className="space-y-3">{correction.charges.map((charge, index) => <div key={charge.id} className="grid gap-3 rounded-lg bg-slate-50 p-3 md:grid-cols-3"><label className="text-xs font-bold">{charge.chargeType} description<input value={charge.description} onChange={(event) => updateCharge(index, 'description', event.target.value)} className={inputClass} /></label><label className="text-xs font-bold">Quantity<input disabled={charge.chargeType === 'WATER'} type="number" min="0" step="0.001" value={charge.quantity} onChange={(event) => updateCharge(index, 'quantity', event.target.value)} className={inputClass} /></label><label className="text-xs font-bold">Rate<input type="number" min="0" step="0.01" value={charge.rateApplied} onChange={(event) => updateCharge(index, 'rateApplied', event.target.value)} className={inputClass} /></label></div>)}</div><label className="block text-xs font-bold">Reason for correction<textarea required minLength="3" value={correction.reason} onChange={(event) => updateCorrection('reason', event.target.value)} className={`${inputClass} min-h-24`} /></label><button disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white">Save corrected SOA</button></form></Panel>}
      {bill && Number(bill.approvedAmount || 0) > 0 && <Panel title="Official Receipt / invoice details" description="These payment fields remain editable after approval."><form onSubmit={saveReferences} className="grid gap-3 md:grid-cols-2"><label className="text-xs font-bold">Official Receipt number<input value={references.officialReceiptNumber} onChange={(event) => setReferences((current) => ({ ...current, officialReceiptNumber: event.target.value }))} className={inputClass} /></label><label className="text-xs font-bold">Invoice number<input value={references.invoiceNumber} onChange={(event) => setReferences((current) => ({ ...current, invoiceNumber: event.target.value }))} className={inputClass} /></label><label className="text-xs font-bold md:col-span-2">Payment note<textarea value={references.paymentNote} onChange={(event) => setReferences((current) => ({ ...current, paymentNote: event.target.value }))} className={`${inputClass} min-h-20`} /></label><button disabled={busy} className="w-fit rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white">Save payment references</button></form></Panel>}
      {bill && <div ref={soaRef}><div className="print-hidden rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">Email delivery: {Number(bill.emailDelivery?.sent || 0)} sent, {Number(bill.emailDelivery?.failed || 0)} failed, {Number(bill.emailDelivery?.pending || 0)} pending.</div><SoaDocument bill={bill} /></div>}
    </DashboardLayout>
  )
}
