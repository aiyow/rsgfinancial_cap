import { useEffect, useState } from 'react'
import { Eye, Maximize2, Pencil, QrCode, RotateCcw, Share2, X, ZoomIn, ZoomOut } from 'lucide-react'
import DashboardLayout, { Panel } from '../../components/DashboardLayout'
import NoticeToast from '../../components/NoticeToast'
import SoaDocument from '../../components/SoaDocument'
import useAuth from '../../hooks/useAuth'
import { apiFile, apiRequest } from '../../services/api'

const inputClass = 'mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal'
const defaultTemplate = {
  companyName: '',
  companyAddress: '',
  statementTitle: '',
  paymentChannel: '',
  paymentAccountName: '',
  paymentAccountNumber: '',
  preparedByName: '',
  preparedByTitle: '',
  checkedByName: '',
  checkedByTitle: '',
  noticeLine1: '',
  noticeLine2: '',
  footerText: '',
  logoPlacement: 'LEFT',
  accentColor: '#166534',
}

const previewBill = {
  id: 'template-preview',
  unitNumber: 'A-101',
  payerName: 'Sample Resident',
  statementDate: '2026-09-20',
  dueDate: '2026-09-30',
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  previousReading: 1240,
  currentReading: 1258,
  totalAmount: 2076,
  remainingBalance: 2076,
  advanceBalance: 0,
  approvedAmount: 0,
  latePenaltyAmount: 0,
  invoiceNumber: 'INV-2026-09-A101',
  charges: [
    { chargeType: 'ASSOCIATION_DUES', description: 'Monthly Association Dues', amount: 1500 },
    { chargeType: 'WATER', description: 'Water Consumption (18 cu. m.)', amount: 576 },
  ],
}

function Field({ label, children }) {
  return <label className="block text-xs font-bold text-slate-600">{label}{children}</label>
}

export default function CollectorSoaTemplatePage() {
  const { token } = useAuth()
  const [form, setForm] = useState(defaultTemplate)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState({ error: '', message: '' })
  const [assetBusy, setAssetBusy] = useState('')
  const [activeTab, setActiveTab] = useState('EDIT')
  const [qrPreviewUrl, setQrPreviewUrl] = useState('')
  const [qrVersion, setQrVersion] = useState(0)
  const [qrZoom, setQrZoom] = useState(1)
  const [qrFullscreen, setQrFullscreen] = useState(false)

  useEffect(() => {
    let active = true
    apiRequest('/api/soa-template', { token })
      .then((data) => { if (active) setForm({ ...defaultTemplate, ...data.template }) })
      .catch((error) => { if (active) setNotice({ error: error.message, message: '' }) })
    return () => { active = false }
  }, [token])

  useEffect(() => {
    let active = true
    let objectUrl = ''
    apiFile('/api/soa-template/assets/qr', { token })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        if (active) setQrPreviewUrl(objectUrl)
        else URL.revokeObjectURL(objectUrl)
      })
      .catch(() => { if (active) setQrPreviewUrl('') })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [token, qrVersion])

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setNotice({ error: '', message: '' })
    try {
      const data = await apiRequest('/api/soa-template', { method: 'PATCH', token, body: form })
      setForm({ ...defaultTemplate, ...data.template })
      setNotice({ error: '', message: data.message })
    } catch (error) {
      setNotice({ error: error.message, message: '' })
    } finally {
      setBusy(false)
    }
  }

  async function uploadAsset(type, file) {
    if (!file) return
    setAssetBusy(type)
    setNotice({ error: '', message: '' })
    try {
      const body = new FormData()
      body.append('asset', file)
      const data = await apiRequest(`/api/soa-template/assets/${type}`, { method: 'POST', token, body })
      if (type === 'qr') setQrVersion((version) => version + 1)
      setNotice({ error: '', message: data.message })
    } catch (error) { setNotice({ error: error.message, message: '' }) } finally { setAssetBusy('') }
  }

  async function shareQr() {
    if (!qrPreviewUrl) return
    try {
      const response = await fetch(qrPreviewUrl)
      const blob = await response.blob()
      const file = new File([blob], 'payment-qr-code.png', { type: blob.type || 'image/png' })
      const shareData = { title: 'Payment QR code', text: 'Official payment QR code', files: [file] }
      if (!navigator.canShare?.(shareData)) throw new Error('Sharing this QR image is not supported in this browser.')
      await navigator.share(shareData)
      setNotice({ error: '', message: 'Payment QR code ready to share.' })
    } catch (error) {
      if (error.name !== 'AbortError') setNotice({ error: error.message || 'The QR code could not be shared.', message: '' })
    }
  }

  return (
    <DashboardLayout title="SOA Settings" description="Manage the official SOA branding, layout styling, and text.">
      <NoticeToast key={notice.error || notice.message || 'empty'} error={notice.error} message={notice.message} />

      <Panel title="SOA branding" description="Upload the association logo and payment QR code shown on staff and resident SOA views.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Association logo"><input accept="image/jpeg,image/png" type="file" onChange={(event) => uploadAsset('logo', event.target.files?.[0])} className={inputClass} /><p className="mt-1 text-xs text-slate-500">JPG or PNG, up to 3 MB.</p></Field>
          <Field label="Payment QR code"><input accept="image/jpeg,image/png" type="file" onChange={(event) => uploadAsset('qr', event.target.files?.[0])} className={inputClass} /><p className="mt-1 text-xs text-slate-500">JPG or PNG, up to 3 MB.</p></Field>
        </div>
        {assetBusy && <p className="mt-3 text-sm text-slate-500">Uploading {assetBusy === 'qr' ? 'payment QR code' : 'logo'}...</p>}
      </Panel>

      <div role="tablist" aria-label="SOA template sections" className="flex w-fit rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        <button type="button" role="tab" id="soa-template-edit-tab" aria-selected={activeTab === 'EDIT'} aria-controls="soa-template-edit-panel" onClick={() => setActiveTab('EDIT')} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition ${activeTab === 'EDIT' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>
          <Pencil size={16} /> Edit template
        </button>
        <button type="button" role="tab" id="soa-template-preview-tab" aria-selected={activeTab === 'PREVIEW'} aria-controls="soa-template-preview-panel" onClick={() => setActiveTab('PREVIEW')} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition ${activeTab === 'PREVIEW' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>
          <Eye size={16} /> Preview template
        </button>
        <button type="button" role="tab" id="soa-template-qr-preview-tab" aria-selected={activeTab === 'QR_PREVIEW'} aria-controls="soa-template-qr-preview-panel" onClick={() => setActiveTab('QR_PREVIEW')} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition ${activeTab === 'QR_PREVIEW' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>
          <QrCode size={16} /> Preview QR
        </button>
      </div>

      {activeTab === 'EDIT' ? (
        <div id="soa-template-edit-panel" role="tabpanel" aria-labelledby="soa-template-edit-tab">
          <Panel title="Editable SOA layout and text" description="Branding changes apply to the SOA display; template text is saved for future generated statements.">
            <form onSubmit={save} className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Company name"><input required value={form.companyName} onChange={(event) => update('companyName', event.target.value)} className={inputClass} /></Field>
            <Field label="Statement title"><input required value={form.statementTitle} onChange={(event) => update('statementTitle', event.target.value)} className={inputClass} /></Field>
            <Field label="Company address"><input required value={form.companyAddress} onChange={(event) => update('companyAddress', event.target.value)} className={inputClass} /></Field>
            <Field label="Payment channel"><input required value={form.paymentChannel} onChange={(event) => update('paymentChannel', event.target.value)} className={inputClass} /></Field>
            <Field label="Payment account name"><input required value={form.paymentAccountName} onChange={(event) => update('paymentAccountName', event.target.value)} className={inputClass} /></Field>
            <Field label="Payment account number"><input required value={form.paymentAccountNumber} onChange={(event) => update('paymentAccountNumber', event.target.value)} className={inputClass} /></Field>
            <Field label="Logo placement"><select value={form.logoPlacement} onChange={(event) => update('logoPlacement', event.target.value)} className={inputClass}><option value="LEFT">Left</option><option value="CENTER">Center</option><option value="RIGHT">Right</option></select></Field>
            <Field label="Header/accent color"><input required type="color" value={form.accentColor} onChange={(event) => update('accentColor', event.target.value)} className={`${inputClass} h-10 p-1`} /></Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Prepared by name"><input required value={form.preparedByName} onChange={(event) => update('preparedByName', event.target.value)} className={inputClass} /></Field>
            <Field label="Checked by name"><input required value={form.checkedByName} onChange={(event) => update('checkedByName', event.target.value)} className={inputClass} /></Field>
            <Field label="Prepared by title"><input required value={form.preparedByTitle} onChange={(event) => update('preparedByTitle', event.target.value)} className={inputClass} /></Field>
            <Field label="Checked by title"><input required value={form.checkedByTitle} onChange={(event) => update('checkedByTitle', event.target.value)} className={inputClass} /></Field>
          </div>

          <div className="grid gap-4">
            <Field label="Notice line 1"><input value={form.noticeLine1} onChange={(event) => update('noticeLine1', event.target.value)} className={inputClass} /></Field>
            <Field label="Notice line 2"><input value={form.noticeLine2} onChange={(event) => update('noticeLine2', event.target.value)} className={inputClass} /></Field>
            <Field label="Footer text"><input required value={form.footerText} onChange={(event) => update('footerText', event.target.value)} className={inputClass} /></Field>
          </div>

              <button disabled={busy} className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white disabled:bg-slate-300">
                {busy ? 'Saving settings...' : 'Save SOA settings'}
              </button>
            </form>
          </Panel>
        </div>
      ) : activeTab === 'PREVIEW' ? (
        <div id="soa-template-preview-panel" role="tabpanel" aria-labelledby="soa-template-preview-tab">
          <Panel title="SOA template preview" description="This sample statement updates from the values currently entered in the Edit template tab. Save the settings when you are ready to use them for future SOAs.">
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-100 p-2 sm:p-4">
              <div className="min-w-[780px]">
                <SoaDocument bill={{ ...previewBill, soaTemplate: form }} />
              </div>
            </div>
          </Panel>
        </div>
      ) : (
        <div id="soa-template-qr-preview-panel" role="tabpanel" aria-labelledby="soa-template-qr-preview-tab">
          <Panel title="Payment QR code preview" description="Residents can use this QR code from their bill payment screen.">
            {qrPreviewUrl ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-xs font-bold text-slate-600">QR size: {Math.round(qrZoom * 100)}%</p>
                  <div className="flex items-center gap-1">
                    <button type="button" disabled={qrZoom <= 0.75} onClick={() => setQrZoom((value) => Math.max(0.75, Number((value - 0.25).toFixed(2))))} aria-label="Zoom out QR code" title="Zoom out" className="grid size-9 place-items-center rounded-lg text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"><ZoomOut size={18} /></button>
                    <button type="button" disabled={qrZoom >= 3} onClick={() => setQrZoom((value) => Math.min(3, Number((value + 0.25).toFixed(2))))} aria-label="Zoom in QR code" title="Zoom in" className="grid size-9 place-items-center rounded-lg text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"><ZoomIn size={18} /></button>
                    {qrZoom !== 1 && <button type="button" onClick={() => setQrZoom(1)} aria-label="Reset QR zoom" title="Reset zoom" className="grid size-9 place-items-center rounded-lg text-slate-700 transition hover:bg-white"><RotateCcw size={17} /></button>}
                    <button type="button" onClick={shareQr} aria-label="Share QR code" title="Share QR code" className="grid size-9 place-items-center rounded-lg text-slate-700 transition hover:bg-white"><Share2 size={18} /></button>
                    <button type="button" onClick={() => setQrFullscreen(true)} aria-label="View QR code full screen" title="View full screen" className="grid size-9 place-items-center rounded-lg text-slate-700 transition hover:bg-white"><Maximize2 size={18} /></button>
                  </div>
                </div>
                <div className="inline-flex max-w-full overflow-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <img src={qrPreviewUrl} alt="Payment QR code" className="max-w-none object-contain" style={{ height: `${288 * qrZoom}px`, width: `${288 * qrZoom}px` }} />
                </div>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">No payment QR code has been uploaded yet. Upload a JPG or PNG image above to preview it here.</p>
            )}
          </Panel>
        </div>
      )}
      {qrFullscreen && qrPreviewUrl && <QrPreviewModal qrUrl={qrPreviewUrl} onClose={() => setQrFullscreen(false)} onShare={shareQr} />}
    </DashboardLayout>
  )
}

function QrPreviewModal({ qrUrl, onClose, onShare }) {
  const [zoom, setZoom] = useState(1)

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/75 p-4" role="presentation" onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="payment-qr-preview-title" className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-2xl bg-white p-5 shadow-2xl sm:p-6" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4"><div><h2 id="payment-qr-preview-title" className="text-xl font-black text-slate-900">Payment QR code</h2><p className="mt-1 text-sm text-slate-600">Scan, zoom, or share the official payment QR code.</p></div><button type="button" onClick={onClose} aria-label="Close full screen QR code" className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100"><X size={21} /></button></div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><p className="text-xs font-bold text-slate-600">QR size: {Math.round(zoom * 100)}%</p><div className="flex items-center gap-1"><button type="button" disabled={zoom <= 0.75} onClick={() => setZoom((value) => Math.max(0.75, Number((value - 0.25).toFixed(2))))} aria-label="Zoom out QR code" title="Zoom out" className="grid size-9 place-items-center rounded-lg text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"><ZoomOut size={18} /></button><button type="button" disabled={zoom >= 3} onClick={() => setZoom((value) => Math.min(3, Number((value + 0.25).toFixed(2))))} aria-label="Zoom in QR code" title="Zoom in" className="grid size-9 place-items-center rounded-lg text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"><ZoomIn size={18} /></button>{zoom !== 1 && <button type="button" onClick={() => setZoom(1)} aria-label="Reset QR zoom" title="Reset zoom" className="grid size-9 place-items-center rounded-lg text-slate-700 transition hover:bg-white"><RotateCcw size={17} /></button>}<button type="button" onClick={onShare} aria-label="Share QR code" title="Share QR code" className="grid size-9 place-items-center rounded-lg text-slate-700 transition hover:bg-white"><Share2 size={18} /></button></div></div>
        <div className="mt-3 flex min-h-0 flex-1 items-start justify-center overflow-auto rounded-xl bg-slate-50 p-5"><img src={qrUrl} alt="Payment QR code" className="max-w-none object-contain" style={{ height: `${360 * zoom}px`, width: `${360 * zoom}px` }} /></div>
        <div className="mt-5 flex justify-end"><button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700">Close</button></div>
      </section>
    </div>
  )
}
