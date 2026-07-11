import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import DashboardLayout, { Panel } from '../../components/DashboardLayout'
import SoaDocument from '../../components/SoaDocument'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

const inputClass = 'mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-bold file:text-white'

function money(value) {
  return `PHP ${Number(value || 0).toFixed(2)}`
}

export default function ResidentBillPage() {
  const { id } = useParams()
  const { token } = useAuth()
  const [bill, setBill] = useState(null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState({ error: '', message: '' })

  useEffect(() => {
    let active = true
    async function loadBill() {
      try {
        const data = await apiRequest(`/api/bills/${id}`, { token })
        if (active) setBill(data.bill)
      } catch (error) {
        if (active) setNotice({ error: error.message, message: '' })
      }
    }
    loadBill()
    return () => { active = false }
  }, [id, token])

  const canSubmit = useMemo(() => bill && bill.paymentStatus !== 'PAID', [bill])

  async function previewReceipt(event) {
    event.preventDefault()
    if (!file) {
      setNotice({ error: 'Choose a JPG or PNG receipt image first.', message: '' })
      return
    }
    setBusy(true)
    setNotice({ error: '', message: '' })
    try {
      const body = new FormData()
      body.append('receipt', file)
      const data = await apiRequest(`/api/payments/bills/${id}/preview`, { method: 'POST', token, body })
      setPreview(data.analysis)
      setNotice({ error: '', message: data.message })
    } catch (error) {
      if (error.data?.analysis) setPreview(error.data.analysis)
      setNotice({ error: error.message, message: '' })
    } finally {
      setBusy(false)
    }
  }

  async function submitReceipt() {
    if (!file) {
      setNotice({ error: 'Choose a receipt image before submitting.', message: '' })
      return
    }
    setBusy(true)
    setNotice({ error: '', message: '' })
    try {
      const body = new FormData()
      body.append('receipt', file)
      const data = await apiRequest(`/api/payments/bills/${id}`, { method: 'POST', token, body })
      setPreview(data.analysis)
      setFile(null)
      setNotice({ error: '', message: data.message })
      const refreshed = await apiRequest(`/api/bills/${id}`, { token })
      setBill(refreshed.bill)
    } catch (error) {
      if (error.data?.analysis) setPreview(error.data.analysis)
      setNotice({ error: error.message, message: '' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <DashboardLayout title="My Statement of Account" description="Review the published SOA and submit your receipt image for Admin verification.">
      <div className="print-hidden flex flex-wrap gap-3">
        <Link to="/resident/bills" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold">Back to my SOAs</Link>
        <Link to="/resident/payments" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold">Open payment history</Link>
        <button onClick={() => window.print()} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white">Print / Save PDF</button>
      </div>

      {(notice.error || notice.message) && <p className={`rounded-lg p-3 text-sm ${notice.error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{notice.error || notice.message}</p>}
      {!bill && !notice.error && <p className="text-sm text-slate-500">Loading your SOA...</p>}

      {bill && (
        <>
          <div className="grid gap-4 md:grid-cols-4 print-hidden">
            <SummaryCard label="Total amount" value={money(bill.totalAmount)} />
            <SummaryCard label="Approved payments" value={money(bill.approvedAmount)} />
            <SummaryCard label="Remaining balance" value={money(bill.remainingBalance)} />
            <SummaryCard label="Advance balance" value={money(bill.advanceBalance)} />
          </div>

          <Panel title="Submit payment proof" description="Upload a clear receipt image so OCR can extract the amount, reference number, and payment date for Admin review.">
            {!canSubmit && <p className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">This SOA is already fully paid.</p>}
            <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
              <form onSubmit={previewReceipt} className="space-y-4">
                <label className="block text-sm font-bold text-slate-700">
                  Receipt image
                  <input type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" onChange={(event) => setFile(event.target.files?.[0] || null)} className={inputClass} />
                </label>
                <div className="flex flex-wrap gap-3">
                  <button disabled={busy || !canSubmit} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold disabled:opacity-50">Preview OCR</button>
                  <button type="button" disabled={busy || !canSubmit || !file} onClick={submitReceipt} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:bg-slate-300">Submit payment proof</button>
                </div>
                <p className="text-xs text-slate-500">Accepted files: JPG or PNG, up to 5 MB.</p>
              </form>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-black text-slate-900">OCR preview</p>
                {!preview && <p className="mt-3 text-sm text-slate-500">Run a preview first to see what the system can read from the receipt.</p>}
                {preview && (
                  <div className="mt-4 space-y-3 text-sm">
                    <InfoRow label="Image quality" value={preview.quality?.status || '—'} />
                    <InfoRow label="Detected amount" value={preview.amount ? money(preview.amount) : 'Not detected'} />
                    <InfoRow label="Detected reference" value={preview.referenceNo || 'Not detected'} />
                    <InfoRow label="Detected payment date" value={preview.paymentDate || 'Not detected'} />
                    <InfoRow label="OCR confidence" value={preview.confidence ? `${preview.confidence}%` : '—'} />
                    <div className="rounded-xl bg-white p-3">
                      <p className="text-xs font-bold uppercase text-slate-400">Extracted text</p>
                      <pre className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{preview.rawText || 'No text extracted.'}</pre>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Panel>

          <SoaDocument bill={bill} />
        </>
      )}
    </DashboardLayout>
  )
}

function SummaryCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-black text-slate-950">{value}</p>
    </div>
  )
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-white p-3">
      <p className="text-slate-500">{label}</p>
      <p className="font-semibold text-slate-900">{value}</p>
    </div>
  )
}
