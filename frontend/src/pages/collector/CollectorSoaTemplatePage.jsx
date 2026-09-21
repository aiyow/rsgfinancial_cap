import { useEffect, useState } from 'react'
import { Eye, Pencil } from 'lucide-react'
import DashboardLayout, { Panel } from '../../components/DashboardLayout'
import NoticeToast from '../../components/NoticeToast'
import SoaDocument from '../../components/SoaDocument'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

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

  useEffect(() => {
    let active = true
    apiRequest('/api/soa-template', { token })
      .then((data) => { if (active) setForm({ ...defaultTemplate, ...data.template }) })
      .catch((error) => { if (active) setNotice({ error: error.message, message: '' }) })
    return () => { active = false }
  }, [token])

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
      setNotice({ error: '', message: data.message })
    } catch (error) { setNotice({ error: error.message, message: '' }) } finally { setAssetBusy('') }
  }

  return (
    <DashboardLayout title="SOA Settings" description="Manage the official SOA branding, layout styling, and text.">
      <NoticeToast key={notice.error || notice.message || 'empty'} error={notice.error} message={notice.message} />

      <Panel title="SOA branding" description="Upload the official association logo shown on staff and resident SOA views.">
        <Field label="Association logo"><input accept="image/jpeg,image/png" type="file" onChange={(event) => uploadAsset('logo', event.target.files?.[0])} className={inputClass} /><p className="mt-1 text-xs text-slate-500">JPG or PNG, up to 3 MB.</p></Field>
        {assetBusy && <p className="mt-3 text-sm text-slate-500">Uploading logo...</p>}
      </Panel>

      <div role="tablist" aria-label="SOA template sections" className="flex w-fit rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        <button type="button" role="tab" id="soa-template-edit-tab" aria-selected={activeTab === 'EDIT'} aria-controls="soa-template-edit-panel" onClick={() => setActiveTab('EDIT')} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition ${activeTab === 'EDIT' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>
          <Pencil size={16} /> Edit template
        </button>
        <button type="button" role="tab" id="soa-template-preview-tab" aria-selected={activeTab === 'PREVIEW'} aria-controls="soa-template-preview-panel" onClick={() => setActiveTab('PREVIEW')} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition ${activeTab === 'PREVIEW' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>
          <Eye size={16} /> Preview template
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
      ) : (
        <div id="soa-template-preview-panel" role="tabpanel" aria-labelledby="soa-template-preview-tab">
          <Panel title="SOA template preview" description="This sample statement updates from the values currently entered in the Edit template tab. Save the settings when you are ready to use them for future SOAs.">
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-100 p-2 sm:p-4">
              <div className="min-w-[780px]">
                <SoaDocument bill={{ ...previewBill, soaTemplate: form }} />
              </div>
            </div>
          </Panel>
        </div>
      )}
    </DashboardLayout>
  )
}
