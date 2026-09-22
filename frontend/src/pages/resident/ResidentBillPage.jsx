import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Download, LoaderCircle, Maximize2, QrCode, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react'
import DashboardLayout, { Panel } from '../../components/DashboardLayout'
import NoticeToast from '../../components/NoticeToast'
import SoaDocument from '../../components/SoaDocument'
import useAuth from '../../hooks/useAuth'
import { apiFile, apiRequest } from '../../services/api'

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
  const [imagePreviewUrl, setImagePreviewUrl] = useState('')
  const [paymentQrUrl, setPaymentQrUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [ocrPreviewing, setOcrPreviewing] = useState(false)
  const [submittingReceipt, setSubmittingReceipt] = useState(false)
  const [notice, setNotice] = useState({ error: '', message: '' })
  const [reportingError, setReportingError] = useState(false)
  const [qrFullscreen, setQrFullscreen] = useState(false)
  const [errorReport, setErrorReport] = useState({ category: 'METER_READING', description: '' })

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

  useEffect(() => {
    let active = true
    let objectUrl = ''
    apiFile('/api/soa-template/assets/qr', { token })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        if (active) setPaymentQrUrl(objectUrl)
        else URL.revokeObjectURL(objectUrl)
      })
      .catch(() => { if (active) setPaymentQrUrl('') })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [token])

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl)
    }
  }, [imagePreviewUrl])

  const canSubmit = useMemo(() => bill && bill.paymentStatus !== 'PAID', [bill])

  function selectReceipt(event) {
    const selectedFile = event.target.files?.[0] || null
    setFile(selectedFile)
    setImagePreviewUrl(selectedFile ? URL.createObjectURL(selectedFile) : '')
    setPreview(null)
    setNotice({ error: '', message: '' })
  }

  async function previewReceipt(event) {
    event.preventDefault()
    if (!file) {
      setNotice({ error: 'Choose a JPG or PNG receipt image first.', message: '' })
      return
    }
    setBusy(true)
    setOcrPreviewing(true)
    setPreview(null)
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
      setOcrPreviewing(false)
    }
  }

  async function submitReceipt() {
    if (!file) {
      setNotice({ error: 'Choose a receipt image before submitting.', message: '' })
      return
    }
    setBusy(true)
    setSubmittingReceipt(true)
    setNotice({ error: '', message: '' })
    try {
      const body = new FormData()
      body.append('receipt', file)
      const data = await apiRequest(`/api/payments/bills/${id}`, { method: 'POST', token, body })
      setPreview(data.analysis)
      setFile(null)
      setImagePreviewUrl('')
      setNotice({ error: '', message: 'Payment proof submitted. Your receipt is now waiting for Admin verification.' })
      const refreshed = await apiRequest(`/api/bills/${id}`, { token })
      setBill(refreshed.bill)
    } catch (error) {
      if (error.data?.analysis) setPreview(error.data.analysis)
      setNotice({ error: error.message, message: '' })
    } finally {
      setBusy(false)
      setSubmittingReceipt(false)
    }
  }

  async function submitBillingError(event) {
    event.preventDefault()
    setBusy(true)
    setNotice({ error: '', message: '' })
    try {
      await apiRequest(`/api/billing-errors/bills/${id}`, { method: 'POST', token, body: errorReport })
      setErrorReport({ category: 'METER_READING', description: '' })
      setReportingError(false)
      setNotice({ error: '', message: 'SOA error report submitted. An Admin will review it shortly.' })
    } catch (error) { setNotice({ error: error.message, message: '' }) } finally { setBusy(false) }
  }

  function downloadPaymentQr() {
    if (!paymentQrUrl) return
    const link = document.createElement('a')
    link.href = paymentQrUrl
    link.download = 'payment-qr-code.png'
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  return (
    <DashboardLayout title="My Statement of Account" description="Review the published SOA and submit your receipt image for Admin verification.">
      <div className="print-hidden flex flex-wrap gap-3">
        <Link to="/resident/bills" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold">Back to my SOAs</Link>
        <Link to="/resident/payments" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold">Open payment history</Link>
        <button onClick={() => window.print()} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white">Print / Save PDF</button>
        <button onClick={() => setReportingError(true)} className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-800 transition hover:bg-amber-600 hover:text-white">Report SOA error</button>
      </div>

      <NoticeToast key={notice.error || notice.message || 'empty'} error={notice.error} message={notice.message} />
      {!bill && !notice.error && <p className="text-sm text-slate-500">Loading your SOA...</p>}

      {bill && (
        <>
          <div className="grid gap-4 print-hidden sm:grid-cols-2 lg:grid-cols-5">
            <SummaryCard label="Total amount" value={money(bill.totalAmount)} accent="blue" />
            {Number(bill.latePenaltyAmount || 0) > 0 && <SummaryCard label={`Late penalty (${Number(bill.latePenaltyPercent || 0).toFixed(2)}%)`} value={money(bill.latePenaltyAmount)} accent="green" />}
            <SummaryCard label="Approved payments" value={money(bill.approvedAmount)} accent="red" />
            <SummaryCard label="Remaining balance" value={money(bill.remainingBalance)} accent="green" />
            <SummaryCard label="Advance balance" value={money(bill.advanceBalance)} accent="blue" />
          </div>

          {paymentQrUrl && <section className="print-hidden overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm">
            <div className="grid items-center gap-5 p-5 sm:grid-cols-[1fr_auto] sm:p-6">
              <div><div className="flex items-center gap-2 text-emerald-700"><span className="grid size-9 place-items-center rounded-lg bg-emerald-100"><QrCode size={20} /></span><p className="font-black">Scan to pay</p></div><p className="mt-3 max-w-xl text-sm text-slate-600">Use your payment app to scan this official QR code, then upload your receipt below for verification.</p><div className="mt-4 flex flex-wrap gap-3"><button type="button" onClick={() => setQrFullscreen(true)} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-800"><Maximize2 size={17} />View full screen</button><button type="button" onClick={downloadPaymentQr} className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-white px-4 py-2.5 text-sm font-bold text-emerald-700 transition hover:bg-emerald-700 hover:text-white"><Download size={17} />Download QR code</button></div></div>
              <button type="button" onClick={() => setQrFullscreen(true)} aria-label="View payment QR code full screen" className="group justify-self-center rounded-xl border border-emerald-100 bg-emerald-50 p-3 shadow-sm transition hover:border-emerald-400 hover:shadow-md"><figure><img src={paymentQrUrl} alt="Official payment QR code" className="size-40 object-contain sm:size-44" /><figcaption className="mt-2 flex items-center justify-center gap-1 text-center text-xs font-black tracking-[0.12em] text-emerald-800">OFFICIAL PAYMENT QR <Maximize2 size={13} /></figcaption></figure></button>
            </div>
          </section>}

          <Panel title="Submit payment proof" description="Upload a clear receipt image so OCR can extract the amount, reference number, and payment date for Admin review.">
            {!canSubmit && <p className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">This SOA is already fully paid.</p>}
            <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
              <form onSubmit={previewReceipt} className="space-y-4">
                <label className="block text-sm font-bold text-slate-700">
                  Receipt image
                  <input type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" onChange={selectReceipt} className={inputClass} />
                </label>
                <div className="flex flex-wrap gap-3">
                  <button disabled={busy || !canSubmit} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50">{ocrPreviewing ? <><LoaderCircle size={16} className="animate-spin" />Reading receipt…</> : 'Preview OCR'}</button>
                  <button type="button" disabled={busy || !canSubmit || !file} onClick={submitReceipt} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:bg-slate-300">{submittingReceipt ? <><LoaderCircle size={16} className="animate-spin" />Submitting proof…</> : 'Submit payment proof'}</button>
                </div>
                {submittingReceipt && <div role="status" className="flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-950"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-indigo-600 shadow-sm"><LoaderCircle size={18} className="animate-spin" /></span><div><p className="font-black">Submitting your payment proof…</p><p className="mt-0.5 text-indigo-800">Please keep this page open while we securely upload your receipt.</p></div></div>}
                <p className="text-xs text-slate-500">Accepted files: JPG or PNG, up to 5 MB.</p>
                {preview && imagePreviewUrl && (
                  <figure className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <figcaption className="mb-2 text-sm font-black text-slate-900">Receipt image preview</figcaption>
                    <img src={imagePreviewUrl} alt="Selected payment receipt" className="max-h-[35rem] w-full rounded-xl bg-white object-contain" />
                  </figure>
                )}
              </form>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-black text-slate-900">OCR preview</p>
                {ocrPreviewing && <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 p-5 text-center"><span className="mx-auto grid size-11 place-items-center rounded-full bg-white text-indigo-600 shadow-sm"><LoaderCircle size={22} className="animate-spin" /></span><p className="mt-3 font-bold text-slate-900">Reading your receipt…</p><p className="mt-1 text-sm text-slate-600">Checking the image and looking for the amount, reference number, and payment date.</p><div className="mt-4 space-y-2"><div className="h-3 animate-pulse rounded-full bg-indigo-100" /><div className="h-3 w-4/5 animate-pulse rounded-full bg-indigo-100" /><div className="h-3 w-3/5 animate-pulse rounded-full bg-indigo-100" /></div></div>}
                {!preview && !ocrPreviewing && <p className="mt-3 text-sm text-slate-500">Run a preview first to see what the system can read from the receipt.</p>}
                {preview && (
                  <div className="mt-4 space-y-3 text-sm">
                    <InfoRow label="Image quality" value={preview.quality?.status || '—'} />
                    <InfoRow label="Detected amount" value={preview.amount ? money(preview.amount) : 'Not detected'} />
                    <InfoRow label="Detected reference" value={preview.referenceNo || 'Not detected'} />
                    <InfoRow label="Detected payment date" value={preview.paymentDate || 'Not detected'} />
                    <InfoRow label="OCR confidence" value={preview.confidence ? `${preview.confidence}%` : '—'} />
                  </div>
                )}
              </div>
            </div>
          </Panel>

          <div className="resident-soa-scroll">
            <div>
              <SoaDocument bill={bill} />
            </div>
          </div>
        </>
      )}
      {reportingError && <ReportSoaErrorModal busy={busy} errorReport={errorReport} onChange={(field, value) => setErrorReport((current) => ({ ...current, [field]: value }))} onClose={() => setReportingError(false)} onSubmit={submitBillingError} />}
      {qrFullscreen && paymentQrUrl && <PaymentQrModal qrUrl={paymentQrUrl} onClose={() => setQrFullscreen(false)} onDownload={downloadPaymentQr} />}
    </DashboardLayout>
  )
}

function ReportSoaErrorModal({ busy, errorReport, onChange, onClose, onSubmit }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" role="presentation" onMouseDown={busy ? undefined : onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="soa-error-title" className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-xl sm:p-6" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4"><div><h2 id="soa-error-title" className="text-xl font-black text-slate-900">Report an SOA error</h2><p className="mt-1 text-sm text-slate-600">Tell the billing staff what appears incorrect. They will review it and notify you when it is resolved.</p></div><button type="button" disabled={busy} onClick={onClose} aria-label="Close SOA error form" className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100"><X size={19} /></button></div>
        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <label className="block text-sm font-bold text-slate-700">Issue category<select value={errorReport.category} onChange={(event) => onChange('category', event.target.value)} className={inputClass}><option value="METER_READING">Meter reading</option><option value="WATER_CHARGE">Water charge</option><option value="ASSOCIATION_DUES">Association dues</option><option value="PAYMENT_OR">Payment / Official Receipt</option><option value="OTHER">Other</option></select></label>
          <label className="block text-sm font-bold text-slate-700">What is incorrect?<textarea required minLength="3" maxLength="1500" value={errorReport.description} onChange={(event) => onChange('description', event.target.value)} placeholder="Describe the issue clearly..." className={`${inputClass} min-h-32`} /></label>
          <div className="flex justify-end gap-3"><button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50">Cancel</button><button disabled={busy} className="rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-amber-700 disabled:opacity-50">{busy ? 'Sending...' : 'Send error report'}</button></div>
        </form>
      </section>
    </div>
  )
}

function PaymentQrModal({ onClose, onDownload, qrUrl }) {
  const [zoom, setZoom] = useState(1)
  const [mobileViewport, setMobileViewport] = useState(() => window.matchMedia('(max-width: 640px)').matches)

  useEffect(() => {
    const media = window.matchMedia('(max-width: 640px)')
    const updateViewport = () => {
      setMobileViewport(media.matches)
      setZoom((value) => Math.min(value, 3))
    }
    updateViewport()
    media.addEventListener('change', updateViewport)
    return () => media.removeEventListener('change', updateViewport)
  }, [])

  const maxZoom = 3
  const qrWidth = (mobileViewport ? 220 : 360) * zoom

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/75 p-2 sm:p-4" role="presentation" onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="payment-qr-title" className="flex h-[calc(100dvh-1rem)] min-h-0 w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white p-4 shadow-2xl sm:h-auto sm:max-h-[92vh] sm:p-6" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-4"><div><h2 id="payment-qr-title" className="text-lg font-black text-slate-900 sm:text-xl">Scan to pay</h2><p className="mt-1 text-xs text-slate-600 sm:text-sm">Open your payment app and scan this official QR code.</p></div><button type="button" onClick={onClose} aria-label="Close full screen QR code" className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100"><X size={21} /></button></div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2"><p className="text-xs font-bold text-emerald-800">QR size: {Math.round(zoom * 100)}%</p><div className="flex items-center gap-1"><button type="button" disabled={zoom <= 0.75} onClick={() => setZoom((value) => Math.max(0.75, Number((value - 0.25).toFixed(2))))} aria-label="Zoom out QR code" title="Zoom out" className="grid size-9 place-items-center rounded-lg text-emerald-800 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"><ZoomOut size={18} /></button><button type="button" disabled={zoom >= maxZoom} onClick={() => setZoom((value) => Math.min(maxZoom, Number((value + 0.25).toFixed(2))))} aria-label="Zoom in QR code" title="Zoom in" className="grid size-9 place-items-center rounded-lg text-emerald-800 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"><ZoomIn size={18} /></button>{zoom !== 1 && <button type="button" onClick={() => setZoom(1)} aria-label="Reset QR zoom" title="Reset zoom" className="grid size-9 place-items-center rounded-lg text-emerald-800 transition hover:bg-white"><RotateCcw size={17} /></button>}</div></div>
        <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-xl bg-emerald-50 p-3 sm:p-5"><div className="flex min-w-full w-max justify-center"><img src={qrUrl} alt="Official payment QR code" className="max-w-none object-contain" style={{ width: `${qrWidth}px` }} /></div></div>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:mt-5 sm:flex-row sm:justify-end sm:gap-3"><button type="button" onClick={onClose} className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 sm:w-auto">Close</button><button type="button" onClick={onDownload} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-800 sm:w-auto"><Download size={17} />Download QR code</button></div>
      </section>
    </div>
  )
}

function SummaryCard({ label, value, accent }) {
  return (
    <div className={`bill-summary-card bill-summary-${accent}`}>
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-3 break-words text-xl font-black text-slate-950">{value}</p>
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
