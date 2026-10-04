import { useState } from 'react'
import useAuth from '../hooks/useAuth'
import { apiRequest } from '../services/api'
import { purposeLabels } from '../utils/chargePayments'

export default function PaymentInvoiceEditor({ bill, payment, onSaved }) {
  const ids = payment ? [payment.id] : [...new Set(Object.values(bill?.chargePayments || {}).flatMap(row => row.payments || []).map(row => row.paymentId))]
  return <section className="space-y-3"><h3 className="text-sm font-black">Issued invoice references</h3><p className="text-xs text-slate-500">Enter staff-issued numbers per approved payment. Bank/GCash references are not invoice numbers. A combined payment may use the same number on both rows.</p>
    {ids.map(id => <InvoiceForm key={id} id={id} initialPayment={payment} onSaved={onSaved} />)}
    {!ids.length && <p className="text-xs text-slate-500">No approved payments applied to this SOA.</p>}
  </section>
}

function InvoiceForm({ id, initialPayment, onSaved }) {
  const { token } = useAuth()
  const [payment, setPayment] = useState(initialPayment)
  const [values, setValues] = useState(Object.fromEntries((initialPayment?.allocations || []).map(row => [row.chargeType, row.invoiceNumber || ''])))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function load() {
    setBusy(true)
    try {
      const data = await apiRequest(`/api/payments/${id}`, { token })
      setPayment(data.payment)
      setValues(Object.fromEntries(data.payment.allocations.map(row => [row.chargeType, row.invoiceNumber || ''])))
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }
  async function save(event) {
    event.preventDefault(); setBusy(true); setMessage('')
    try {
      const data = await apiRequest(`/api/payments/${id}/invoice-references`, { method: 'PATCH', token,
        body: { invoices: payment.allocations.map(row => ({ chargeType: row.chargeType, invoiceNumber: values[row.chargeType] || null })) } })
      setPayment(data.payment); await onSaved?.(); setMessage(data.message)
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }
  if (!payment) return <div><button type="button" disabled={busy} onClick={load} className="min-h-11 rounded-lg border border-emerald-200 px-3 text-xs font-bold">Edit invoices · Payment #{id}</button>{message && <p role="status" className="text-xs">{message}</p>}</div>
  return <form onSubmit={save} className="rounded-lg border border-emerald-100 p-3"><p className="mb-2 text-xs font-bold">Payment #{id} · Transaction {payment.verifiedReferenceNo || '—'}</p><div className="grid gap-3 sm:grid-cols-2">{payment.allocations.map(row => <label key={row.chargeType} className="text-xs font-semibold">{purposeLabels[row.chargeType]} invoice<input maxLength={100} value={values[row.chargeType] || ''} onChange={event => setValues(current => ({ ...current, [row.chargeType]: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>)}</div><button disabled={busy} className="mt-3 min-h-11 rounded-lg bg-emerald-700 px-3 text-xs font-bold text-white">{busy ? 'Saving…' : 'Save issued invoices'}</button>{message && <p role="status" className="mt-2 text-xs">{message}</p>}</form>
}
