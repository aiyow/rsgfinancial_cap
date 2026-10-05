import { useEffect, useState } from 'react'
import useAuth from '../hooks/useAuth'
import { apiRequest } from '../services/api'
import { currency, purposeLabels } from '../utils/chargePayments'
import { paymentDateLabel, paymentMethodLabel } from '../utils/paymentHistory'

export default function PaymentInvoiceEditor({ bill, payment, onSaved }) {
  const categories = ['WATER', 'ASSOCIATION_DUES'].map(chargeType => {
    const rows = payment
      ? (payment.reviewStatus === 'APPROVED' ? (payment.allocations || []).filter(row => row.chargeType === chargeType).map(row => ({ ...row, paymentId: payment.id })) : [])
      : bill?.chargePayments?.[chargeType]?.payments || []
    return { chargeType, entries: [...new Map(rows.map(row => [row.paymentId, row])).values()] }
  }).filter(category => category.entries.length)

  if (!categories.length) return null
  return <section className="space-y-3" aria-label="Invoice numbers">
    <h3 className="text-sm font-black">Invoice numbers</h3>
    <p className="text-xs text-slate-500">Add the invoice number for each approved charge payment. A combined payment may use the same invoice number for both charges.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      {categories.map(({ chargeType, entries }) => <InvoiceCategory key={chargeType} chargeType={chargeType} entries={entries} initialPayment={payment} onSaved={onSaved} />)}
    </div>
  </section>
}

function InvoiceCategory({ chargeType, entries, initialPayment, onSaved }) {
  const [open, setOpen] = useState(false)
  const label = purposeLabels[chargeType]
  const hasInvoice = entries.some(row => row.invoiceNumber)
  return <details className="min-w-0 rounded-xl border border-emerald-100 bg-white" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="min-h-11 cursor-pointer rounded-xl px-4 py-3 text-sm font-bold text-emerald-800 focus-visible:outline-2 focus-visible:outline-emerald-600">{hasInvoice ? 'Edit' : 'Add'} {label} Invoice</summary>
    {open && <div className="space-y-3 border-t border-emerald-100 p-3">
      {entries.map(entry => <InvoiceForm key={entry.paymentId} id={entry.paymentId} chargeType={chargeType} initialPayment={initialPayment} onSaved={onSaved} />)}
    </div>}
  </details>
}

function InvoiceForm({ id, chargeType, initialPayment, onSaved }) {
  const { token } = useAuth()
  const [payment, setPayment] = useState(initialPayment)
  const [value, setValue] = useState(initialPayment?.allocations?.find(row => row.chargeType === chargeType)?.invoiceNumber || '')
  const [loading, setLoading] = useState(!initialPayment)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [loadError, setLoadError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (initialPayment) return undefined
    let active = true
    queueMicrotask(() => { if (active) { setLoading(true); setLoadError('') } })
    apiRequest(`/api/payments/${id}`, { token })
      .then(data => {
        if (!active) return
        if (data.payment.reviewStatus !== 'APPROVED') throw new Error('Invoices can only be added to approved payments.')
        const allocation = data.payment.allocations.find(row => row.chargeType === chargeType)
        if (!allocation) throw new Error('This payment has no allocation for this charge.')
        setPayment(data.payment)
        setValue(allocation.invoiceNumber || '')
      })
      .catch(error => { if (active) setLoadError(error.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id, chargeType, initialPayment, token, retry])

  async function save(event) {
    event.preventDefault(); setBusy(true); setMessage('')
    try {
      const data = await apiRequest(`/api/payments/${id}/invoice-references`, { method: 'PATCH', token,
        body: { invoices: [{ chargeType, invoiceNumber: value.trim() || null }] } })
      setPayment(data.payment); await onSaved?.(); setMessage(data.message)
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }
  if (loading) return <p role="status" className="text-xs text-slate-500">Loading approved payment…</p>
  if (loadError) return <div><p role="alert" className="text-xs text-red-700">{loadError}</p><button type="button" onClick={() => setRetry(current => current + 1)} className="mt-2 min-h-11 text-xs font-bold text-emerald-800 underline">Try again</button></div>
  if (!payment) return null
  const label = purposeLabels[chargeType]
  const allocation = payment.allocations.find(row => row.chargeType === chargeType)
  return <form onSubmit={save} className="rounded-lg border border-emerald-100 p-3">
    <p className="mb-3 text-xs text-slate-500">Paid on {paymentDateLabel(payment.verifiedPaymentDate)} · {currency(allocation?.allocatedAmount)} · {paymentMethodLabel(payment.paymentMethod)}</p>
    <label className="block text-xs font-semibold">{label} invoice number<input maxLength={100} disabled={busy} value={value} onChange={event => setValue(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
    <button disabled={busy} className="mt-3 min-h-11 rounded-lg bg-emerald-700 px-3 text-xs font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : `Save ${label} Invoice`}</button>
    {message && <p role="status" className="mt-2 text-xs">{message}</p>}
  </form>
}
