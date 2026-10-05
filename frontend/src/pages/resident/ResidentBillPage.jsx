import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Download, FileClock, LoaderCircle, Printer, QrCode, RotateCcw, Upload, X, ZoomIn, ZoomOut } from 'lucide-react'
import DashboardLayout from '../../components/DashboardLayout'
import NoticeToast from '../../components/NoticeToast'
import SoaViewer from '../../components/SoaViewer'
import ChargePaymentSummary from '../../components/ChargePaymentSummary'
import { isWaterOnly, payableBalance, purposeLabels } from '../../utils/chargePayments'
import useAuth from '../../hooks/useAuth'
import { apiFile, apiRequest } from '../../services/api'

const inputClass = 'mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-bold file:text-white'

function money(value) {
  return `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function ResidentBillPage() {
  const { id } = useParams()
  const { token } = useAuth()
  const navigate = useNavigate()
  const [bill, setBill] = useState(null)
  const [paymentPurpose, setPaymentPurpose] = useState('')
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
  const [paymentProofOpen, setPaymentProofOpen] = useState(false)
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

  const purposes = bill?.allowedPaymentPurposes || []
  const selectedPurpose = purposes.includes(paymentPurpose) ? paymentPurpose : purposes.includes('COMBINED') ? 'COMBINED' : purposes[0] || ''
  const selectedBalance = selectedPurpose === 'COMBINED' ? Number(bill?.remainingBalance || 0) : Number(bill?.chargePayments?.[selectedPurpose]?.remainingBalance || 0)
  const canSubmit = Boolean(selectedPurpose && selectedBalance > 0)

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
      body.append('paymentPurpose', selectedPurpose)
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
      body.append('paymentPurpose', selectedPurpose)
      const data = await apiRequest(`/api/payments/bills/${id}`, { method: 'POST', token, body })
      setFile(null)
      setImagePreviewUrl('')
      setPaymentProofOpen(false)
      navigate('/resident/payments', {
        replace: true,
        state: {
          filter: 'PENDING',
          submissionNotice: `${data.message || 'Your receipt was submitted successfully.'} It is now waiting for Admin review. You will see the verified amount once it is approved.`,
        },
      })
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
      const result = await apiRequest(`/api/billing-errors/bills/${id}`, { method: 'POST', token, body: errorReport })
      setErrorReport({ category: 'METER_READING', description: '' })
      setReportingError(false)
      const remaining = Number(result.reportsRemaining)
      setNotice({ error: '', message: `SOA error report submitted. An Admin will review it shortly.${Number.isFinite(remaining) ? ` You have ${remaining} report${remaining === 1 ? '' : 's'} remaining for this SOA.` : ''}` })
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
    <DashboardLayout title="My Statement of Account" className="resident-shell resident-bills-shell resident-bill-detail-shell">
      <div className="print-hidden space-y-2">
        <div className="flex items-center justify-between gap-3"><Link to="/resident/bills" className="inline-flex min-h-11 items-center gap-1.5 text-xs font-bold text-emerald-800 hover:underline"><ArrowLeft size={16} aria-hidden="true" />My SOAs</Link><h1 className="text-sm font-black text-slate-950">{bill ? `Unit ${bill.unitNumber} · SOA` : 'Statement of account'}</h1></div>
        <div className="grid grid-cols-3 gap-2 sm:flex">
          <Link to="/resident/payments" className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-bold text-slate-700 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"><FileClock size={15} aria-hidden="true" />History</Link>
          <button type="button" onClick={() => window.print()} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-2 py-2 text-xs font-bold text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"><Printer size={15} aria-hidden="true" />Print / PDF</button>
          <button type="button" onClick={() => setReportingError(true)} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 px-2 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600">Report error</button>
        </div>
      </div>

      <NoticeToast key={notice.error || notice.message || 'empty'} error={notice.error} message={notice.message} />
      {!bill && !notice.error && <BillPageSkeleton />}

      {bill && (
        <>
          <section className="print-hidden overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-sm" aria-label="Statement balance summary">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-emerald-50/60 px-3.5 py-3 sm:px-5">
              <div><p className="text-xs text-slate-500">{isWaterOnly(bill) ? 'Water balance' : 'Balance due'}</p><p className="mt-0.5 text-2xl font-black tracking-tight tabular-nums text-slate-950">{money(payableBalance(bill))}</p></div>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${bill.paymentStatus === 'PAID' ? 'bg-emerald-100 text-emerald-800' : bill.paymentStatus === 'OVERDUE' ? 'bg-rose-100 text-rose-800' : bill.paymentStatus === 'PARTIAL' ? 'bg-sky-100 text-sky-800' : 'bg-amber-100 text-amber-800'}`}>{bill.paymentStatus}</span>
            </div>
            <dl className="grid grid-cols-2 gap-3 border-t border-emerald-100 px-3.5 py-3 sm:grid-cols-4 sm:px-5">
              <SummaryCard label="Total amount" value={money(bill.totalAmount)} />
              <SummaryCard label="Approved payments" value={money(bill.approvedAmount)} />
              <SummaryCard label="Advance balance" value={money(bill.advanceBalance)} />
              {Number(bill.latePenaltyAmount || 0) > 0 && <SummaryCard label={`Late penalty (${Number(bill.latePenaltyPercent || 0).toFixed(2)}%)`} value={money(bill.latePenaltyAmount)} />}
            </dl>
            <div className="border-t border-emerald-100 p-3"><ChargePaymentSummary bill={bill} /></div>
          </section>

          <SoaViewer key={bill.id || id} bill={bill} />

          <section className="print-hidden rounded-xl border border-emerald-200 bg-white p-3.5 shadow-sm sm:p-5">
            <label className="mb-3 block text-xs font-bold">Payment purpose<select value={selectedPurpose} disabled={purposes.length < 2 || busy} onChange={event => { setPaymentPurpose(event.target.value); setPreview(null) }} className={inputClass}>{purposes.map(purpose => <option key={purpose} value={purpose}>{purposeLabels[purpose]}</option>)}</select></label>
            <p className="mb-3 text-xs text-slate-600">Selected balance: {money(selectedBalance)}. {isWaterOnly(bill) ? 'Tenants pay water only.' : 'Combined payments pay association dues first; excess stays as association advance.'}</p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div><h2 className="text-sm font-black text-slate-950">Payment actions</h2><p className="mt-1 text-xs text-slate-600">Pay, then upload your receipt for Admin review.</p></div>
              <div className="grid grid-cols-2 gap-2 sm:flex"><button type="button" disabled={!paymentQrUrl} onClick={() => setQrFullscreen(true)} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"><QrCode size={16} aria-hidden="true" />Scan to pay</button><button type="button" disabled={!canSubmit} onClick={() => setPaymentProofOpen(true)} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300"><Upload size={16} aria-hidden="true" />{canSubmit ? 'Upload receipt' : 'Fully paid'}</button></div>
            </div>
            <details className="mt-3 border-t border-emerald-100 pt-2 text-xs text-slate-600"><summary className="min-h-11 cursor-pointer py-3 font-semibold text-emerald-800">How to submit payment proof</summary><ol className="list-decimal space-y-1.5 pl-5 pb-2"><li>Open Scan to pay.</li><li>Pay the selected category balance shown above.</li><li>Choose your JPG or PNG receipt image.</li><li>Preview OCR, check the details, then submit proof.</li></ol></details>
          </section>
        </>
      )}
      {reportingError && <ReportSoaErrorModal busy={busy} errorReport={errorReport} onChange={(field, value) => setErrorReport((current) => ({ ...current, [field]: value }))} onClose={() => setReportingError(false)} onSubmit={submitBillingError} />}
      {qrFullscreen && paymentQrUrl && <PaymentQrModal qrUrl={paymentQrUrl} onClose={() => setQrFullscreen(false)} onDownload={downloadPaymentQr} />}
      {paymentProofOpen && <SubmitPaymentProofModal paymentPurpose={selectedPurpose} busy={busy} file={file} preview={preview} imagePreviewUrl={imagePreviewUrl} ocrPreviewing={ocrPreviewing} submittingReceipt={submittingReceipt} onClose={() => setPaymentProofOpen(false)} onSelectReceipt={selectReceipt} onPreview={previewReceipt} onSubmit={submitReceipt} />}
    </DashboardLayout>
  )
}

function SubmitPaymentProofModal({ paymentPurpose, busy, file, preview, imagePreviewUrl, ocrPreviewing, submittingReceipt, onClose, onSelectReceipt, onPreview, onSubmit }) {
  const modalRef = useRef(null)

  useEffect(() => {
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    modalRef.current?.querySelector('[aria-label="Close payment proof form"]')?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      previousFocus?.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab') return
      const modal = modalRef.current
      const controls = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')]
      if (!controls.length) { event.preventDefault(); return }
      const first = controls[0]
      const last = controls.at(-1)
      if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
        event.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [busy, onClose])

  return (
    <div className="payment-proof-backdrop fixed inset-0 z-50 grid place-items-center bg-slate-950/50" role="presentation" onMouseDown={busy ? undefined : onClose}>
      <section ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="payment-proof-title" className="payment-proof-dialog flex h-[100dvh] w-screen max-w-none flex-col overflow-hidden bg-white shadow-2xl lg:h-[80dvh] lg:w-[80vw] lg:rounded-2xl lg:border lg:border-slate-200" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6"><div><p className="text-sm font-semibold text-emerald-700">Payment Proof</p><h2 id="payment-proof-title" className="mt-1 text-xl font-black text-slate-950">Submit your receipt</h2><p className="mt-1 text-sm font-bold text-emerald-800">For: {purposeLabels[paymentPurpose]}</p><p className="mt-1 text-sm text-slate-600">Upload a clear JPG or PNG receipt, preview the extracted details, then submit it for Admin review.</p></div><button type="button" disabled={busy} onClick={onClose} aria-label="Close payment proof form" className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 disabled:opacity-50"><X size={20} /></button></header>
        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 lg:grid-cols-[0.9fr_1.1fr] sm:p-6">
          <form onSubmit={onPreview} className="space-y-4">
            <ol className="grid gap-2 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-950 sm:grid-cols-3"><li><strong>1. Choose</strong> a receipt image</li><li><strong>2. Preview OCR</strong> and check the details</li><li><strong>3. Submit</strong> for Admin review</li></ol>
            <label className="block text-sm font-bold text-slate-700">Receipt image<input type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" onChange={onSelectReceipt} className={inputClass} /></label>
            <p className="text-xs text-slate-500">Accepted files: JPG or PNG, up to 5 MB.</p>
            <div className="flex flex-wrap gap-3"><button disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">{ocrPreviewing ? <><LoaderCircle size={16} className="animate-spin" />Reading receipt…</> : 'Preview OCR'}</button><button type="button" disabled={busy || !file} onClick={onSubmit} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300">{submittingReceipt ? <><LoaderCircle size={16} className="animate-spin" />Submitting proof…</> : 'Submit payment proof'}</button></div>
            {submittingReceipt && <div role="status" className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-emerald-700 shadow-sm"><LoaderCircle size={18} className="animate-spin" /></span><div><p className="font-black">Submitting your payment proof…</p><p className="mt-0.5 text-emerald-800">Please keep this window open while we upload your receipt.</p></div></div>}
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-sm font-black text-slate-900">OCR Preview</p>{ocrPreviewing && <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50 p-5 text-center"><span className="mx-auto grid size-11 place-items-center rounded-full bg-white text-emerald-700 shadow-sm"><LoaderCircle size={22} className="animate-spin" /></span><p className="mt-3 font-bold text-slate-900">Reading your receipt…</p><p className="mt-1 text-sm text-slate-600">Checking the image for the amount, reference number, and payment date.</p><div className="mt-4 space-y-2"><div className="h-3 animate-pulse rounded-full bg-emerald-100" /><div className="h-3 w-4/5 animate-pulse rounded-full bg-emerald-100" /><div className="h-3 w-3/5 animate-pulse rounded-full bg-emerald-100" /></div></div>}{!preview && !ocrPreviewing && <p className="mt-3 text-sm text-slate-500">Choose a receipt, then run Preview OCR to check what the system can read.</p>}{preview && <div className="mt-4 space-y-3 text-sm"><InfoRow label="Image quality" value={preview.quality?.status || '—'} /><InfoRow label="Detected amount" value={preview.amount ? money(preview.amount) : 'Not detected'} /><InfoRow label="Detected reference" value={preview.referenceNo || 'Not detected'} /><InfoRow label="Detected payment date" value={preview.paymentDate || 'Not detected'} /><InfoRow label="OCR confidence" value={preview.confidence ? `${preview.confidence}%` : '—'} /></div>}</div>
          </form>
          <div className="flex min-h-[18rem] flex-col rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-sm font-black text-slate-900">Receipt Image Preview</p>{imagePreviewUrl ? <img src={imagePreviewUrl} alt="Selected payment receipt" className="mt-4 min-h-0 flex-1 rounded-xl bg-white object-contain" /> : <p className="mt-3 text-sm text-slate-500">Choose a receipt image to preview it here.</p>}</div>
        </div>
      </section>
    </div>
  )
}

function BillPageSkeleton() {
  return (
    <div className="animate-pulse" aria-label="Loading statement of account" role="status">
      <span className="sr-only">Loading your statement of account…</span>
      <section className="rounded-xl border border-emerald-100 bg-white p-3.5"><div className="h-3 w-24 rounded bg-emerald-100" /><div className="mt-2 h-7 w-36 rounded bg-emerald-200" /><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{Array.from({ length: 3 }, (_, index) => <div key={index} className="h-10 rounded-lg bg-emerald-50" />)}</div></section>
      <section className="mt-3 overflow-hidden rounded-xl border border-emerald-100 bg-white p-3.5"><div className="h-11 rounded-lg bg-emerald-50" /><div className="mt-3 h-48 rounded bg-slate-100" /></section>
    </div>
  )
}

function ReportSoaErrorModal({ busy, errorReport, onChange, onClose, onSubmit }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" role="presentation" onMouseDown={busy ? undefined : onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="soa-error-title" className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-xl sm:p-6" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4"><div><h2 id="soa-error-title" className="text-xl font-black text-slate-900">Report an SOA error</h2><p className="mt-1 text-sm text-slate-600">Tell the billing staff what appears incorrect. They will review it and notify you when it is resolved.</p></div><button type="button" disabled={busy} onClick={onClose} aria-label="Close SOA error form" className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100"><X size={19} /></button></div>
        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <label className="block text-sm font-bold text-slate-700">Issue category<select value={errorReport.category} onChange={(event) => onChange('category', event.target.value)} className={inputClass}><option value="METER_READING">Meter reading</option><option value="WATER_CHARGE">Water charge</option><option value="ASSOCIATION_DUES">Association dues</option><option value="PAYMENT_OR">Payment / Invoice</option><option value="OTHER">Other</option></select></label>
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

function SummaryCard({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-slate-500 sm:text-xs">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-semibold tabular-nums text-slate-950">{value}</dd>
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
