import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import DashboardLayout, { Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiFile, apiRequest } from '../../services/api'

const inputClass = 'mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm'
const methods = ['GCASH', 'BANK_TRANSFER', 'CASH', 'OTHER']

function money(value) {
  return `PHP ${Number(value || 0).toFixed(2)}`
}

function dateTime(value) {
  return value ? new Date(value).toLocaleString() : '-'
}

function methodLabel(value) {
  return value ? value.replace('_', ' ') : 'Not set'
}

function reviewFormFrom(payment) {
  return {
    status: 'APPROVED',
    verifiedAmount: payment.ocrAmount || '',
    paymentMethod: payment.paymentMethod || 'GCASH',
    verifiedReferenceNo: payment.ocrReferenceNo || '',
    verifiedPaymentDate: payment.ocrPaymentDate ? String(payment.ocrPaymentDate).slice(0, 10) : '',
    remarks: '',
  }
}

export default function AdminPaymentPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { token } = useAuth()
  const [payment, setPayment] = useState(null)
  const [form, setForm] = useState(null)
  const [receiptUrl, setReceiptUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState({ error: '', message: '' })
  const urlRef = useRef('')

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const paymentData = await apiRequest(`/api/payments/${id}`, { token })
        if (!active) return
        setPayment(paymentData.payment)
        setForm(reviewFormFrom(paymentData.payment))
        if (paymentData.payment.entryType === 'RECEIPT_UPLOAD') {
          const receiptBlob = await apiFile(`/api/payments/${id}/receipt`, { token })
          if (!active) return
          const objectUrl = URL.createObjectURL(receiptBlob)
          urlRef.current = objectUrl
          setReceiptUrl(objectUrl)
        }
      } catch (error) {
        if (active) setNotice({ error: error.message, message: '' })
      }
    }
    load()
    return () => {
      active = false
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [id, token])

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setNotice({ error: '', message: '' })
    try {
      const body = form.status === 'APPROVED'
        ? {
            status: 'APPROVED',
            verifiedAmount: Number(form.verifiedAmount),
            paymentMethod: form.paymentMethod,
            verifiedReferenceNo: form.verifiedReferenceNo || undefined,
            verifiedPaymentDate: form.verifiedPaymentDate,
            remarks: form.remarks || undefined,
          }
        : {
            status: 'REJECTED',
            remarks: form.remarks,
          }
      const data = await apiRequest(`/api/payments/${id}/review`, { method: 'POST', token, body })
      const refreshed = await apiRequest(`/api/payments/${id}`, { token })
      setPayment(refreshed.payment)
      setForm(reviewFormFrom(refreshed.payment))
      setNotice({ error: '', message: data.message })
    } catch (error) {
      setNotice({ error: error.message, message: '' })
    } finally {
      setBusy(false)
    }
  }

  async function removeRejectedPayment() {
    if (!payment || payment.reviewStatus !== 'REJECTED') return
    if (!window.confirm('Permanently delete this rejected payment proof? This cannot be undone.')) return
    setBusy(true)
    setNotice({ error: '', message: '' })
    try {
      const data = await apiRequest(`/api/payments/${id}`, { method: 'DELETE', token })
      navigate('/admin/payments', { replace: true, state: { message: data.message } })
    } catch (error) {
      setNotice({ error: error.message, message: '' })
      setBusy(false)
    }
  }

  return (
    <DashboardLayout title="Payment verification" description="Compare uploaded receipts or review Admin-recorded payment details.">
      <div className="flex flex-wrap gap-3">
        <Link to="/admin/payments" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold">Back to payments</Link>
        {payment?.targetBillId && <Link to={`/admin/soa/bills/${payment.targetBillId}`} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold">Open target SOA</Link>}
        {payment?.reviewStatus === 'REJECTED' && <button disabled={busy} onClick={removeRejectedPayment} className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-bold text-rose-700 disabled:opacity-50">Delete rejected proof</button>}
      </div>

      {(notice.error || notice.message) && <p className={`rounded-lg p-3 text-sm ${notice.error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{notice.error || notice.message}</p>}
      {!payment && !notice.error && <p className="text-sm text-slate-500">Loading payment...</p>}

      {payment && (
        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <Panel title={`${payment.entryType === 'MANUAL' ? 'Manual payment' : 'Receipt'} for Unit ${payment.unitNumber}`} description={`Submitted by ${payment.submittedByName} on ${dateTime(payment.submittedAt)}.`}>
            {receiptUrl && <img src={receiptUrl} alt="Uploaded payment receipt" className="w-full rounded-xl border border-slate-200 bg-slate-50 object-contain" />}
            {payment.entryType === 'MANUAL' && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">This payment was recorded by Admin and does not have an uploaded receipt image.</p>}
            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              <Fact label="Review status" value={payment.reviewStatus} />
              <Fact label="Source" value={payment.entryType === 'MANUAL' ? 'Manual entry' : 'Receipt upload'} />
              <Fact label="Payment method" value={methodLabel(payment.paymentMethod)} />
              <Fact label="Bill total" value={money(payment.billTotal)} />
              <Fact label="Applied to SOA" value={money(payment.appliedAmount)} />
              <Fact label="Unit advance balance" value={money(payment.unitAdvanceBalance)} />
              <Fact label="Remaining balance" value={money(payment.remainingBalance)} />
              <Fact label="OCR quality" value={payment.ocrQualityStatus || '-'} />
              <Fact label="OCR confidence" value={payment.ocrConfidence ? `${payment.ocrConfidence}%` : '-'} />
            </dl>
            {payment.entryType === 'RECEIPT_UPLOAD' && (
              <div className="mt-5 rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase text-slate-500">Raw OCR text</p>
                <pre className="mt-3 whitespace-pre-wrap break-words text-sm text-slate-700">{payment.ocrRawText || 'No OCR text was extracted.'}</pre>
              </div>
            )}
          </Panel>

          <div className="space-y-6">
            <Panel title="Detected fields">
              <dl className="grid gap-4 sm:grid-cols-2">
                <Fact label="OCR amount" value={payment.ocrAmount ? money(payment.ocrAmount) : 'Not detected'} />
                <Fact label="OCR reference" value={payment.ocrReferenceNo || 'Not detected'} />
                <Fact label="OCR payment date" value={payment.ocrPaymentDate ? String(payment.ocrPaymentDate).slice(0, 10) : 'Not detected'} />
                <Fact label="Resident due date" value={payment.dueDate ? String(payment.dueDate).slice(0, 10) : '-'} />
              </dl>
            </Panel>

            <Panel title={payment.reviewStatus === 'PENDING' ? 'Review decision' : 'Review outcome'} description={payment.reviewStatus === 'PENDING' ? 'Approve with corrected values or reject with remarks.' : 'This payment has already been finalized.'}>
              {payment.reviewStatus === 'PENDING' ? (
                <form onSubmit={submit} className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => update('status', 'APPROVED')} className={`rounded-full px-4 py-2 text-sm font-bold ${form.status === 'APPROVED' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'}`}>Approve</button>
                    <button type="button" onClick={() => update('status', 'REJECTED')} className={`rounded-full px-4 py-2 text-sm font-bold ${form.status === 'REJECTED' ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-700'}`}>Reject</button>
                  </div>

                  {form.status === 'APPROVED' && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block text-sm font-bold text-slate-700">
                        Payment method
                        <select required value={form.paymentMethod} onChange={(event) => update('paymentMethod', event.target.value)} className={inputClass}>
                          {methods.map((method) => <option key={method} value={method}>{methodLabel(method)}</option>)}
                        </select>
                      </label>
                      <label className="block text-sm font-bold text-slate-700">
                        Verified amount
                        <input required min="0.01" step="0.01" type="number" value={form.verifiedAmount} onChange={(event) => update('verifiedAmount', event.target.value)} className={inputClass} />
                      </label>
                      <label className="block text-sm font-bold text-slate-700">
                        Verified reference
                        <input value={form.verifiedReferenceNo} onChange={(event) => update('verifiedReferenceNo', event.target.value)} placeholder="Auto-generated if blank" className={inputClass} />
                      </label>
                      <label className="block text-sm font-bold text-slate-700">
                        Verified payment date
                        <input required type="date" value={form.verifiedPaymentDate} onChange={(event) => update('verifiedPaymentDate', event.target.value)} className={inputClass} />
                      </label>
                    </div>
                  )}

                  <label className="block text-sm font-bold text-slate-700">
                    {form.status === 'APPROVED' ? 'Remarks (optional)' : 'Rejection remarks'}
                    <textarea required={form.status === 'REJECTED'} value={form.remarks} onChange={(event) => update('remarks', event.target.value)} className={`${inputClass} min-h-28`} />
                  </label>

                  <button disabled={busy} className={`rounded-lg px-5 py-2.5 text-sm font-bold text-white disabled:bg-slate-300 ${form.status === 'APPROVED' ? 'bg-emerald-600' : 'bg-rose-600'}`}>
                    {busy ? 'Saving review...' : form.status === 'APPROVED' ? 'Approve payment' : 'Reject payment'}
                  </button>
                </form>
              ) : (
                <dl className="grid gap-4 sm:grid-cols-2">
                  <Fact label="Final status" value={payment.reviewStatus} />
                  <Fact label="Reviewed at" value={dateTime(payment.reviewedAt)} />
                  <Fact label="Payment method" value={methodLabel(payment.paymentMethod)} />
                  <Fact label="Source" value={payment.entryType === 'MANUAL' ? 'Manual entry' : 'Receipt upload'} />
                  <Fact label="Verified amount" value={payment.verifiedAmount ? money(payment.verifiedAmount) : '-'} />
                  <Fact label="Applied amount" value={money(payment.appliedAmount)} />
                  <Fact label="Unapplied advance" value={money(payment.unappliedAmount)} />
                  <Fact label="Verified reference" value={payment.verifiedReferenceNo || '-'} />
                  <Fact label="Verified payment date" value={payment.verifiedPaymentDate ? String(payment.verifiedPaymentDate).slice(0, 10) : '-'} />
                  <Fact label="Remarks" value={payment.remarks || '-'} />
                </dl>
              )}
            </Panel>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}

function Fact({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-bold uppercase text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  )
}
