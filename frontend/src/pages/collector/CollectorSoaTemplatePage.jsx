import { useEffect, useState } from 'react'
import DashboardLayout, { Panel } from '../../components/DashboardLayout'
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
}

function Field({ label, children }) {
  return <label className="block text-xs font-bold text-slate-600">{label}{children}</label>
}

export default function CollectorSoaTemplatePage() {
  const { token } = useAuth()
  const [form, setForm] = useState(defaultTemplate)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState({ error: '', message: '' })

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

  return (
    <DashboardLayout title="SOA Template" description="Edit the text used on future generated Statement of Account documents.">
      {(notice.error || notice.message) && <p className={`rounded-lg p-3 text-sm ${notice.error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{notice.error || notice.message}</p>}

      <Panel title="Editable SOA text" description="Changes apply to future generated SOAs. Existing SOAs keep their saved template snapshot.">
        <form onSubmit={save} className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Company name"><input required value={form.companyName} onChange={(event) => update('companyName', event.target.value)} className={inputClass} /></Field>
            <Field label="Statement title"><input required value={form.statementTitle} onChange={(event) => update('statementTitle', event.target.value)} className={inputClass} /></Field>
            <Field label="Company address"><input required value={form.companyAddress} onChange={(event) => update('companyAddress', event.target.value)} className={inputClass} /></Field>
            <Field label="Payment channel"><input required value={form.paymentChannel} onChange={(event) => update('paymentChannel', event.target.value)} className={inputClass} /></Field>
            <Field label="Payment account name"><input required value={form.paymentAccountName} onChange={(event) => update('paymentAccountName', event.target.value)} className={inputClass} /></Field>
            <Field label="Payment account number"><input required value={form.paymentAccountNumber} onChange={(event) => update('paymentAccountNumber', event.target.value)} className={inputClass} /></Field>
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
            {busy ? 'Saving template...' : 'Save SOA template'}
          </button>
        </form>
      </Panel>
    </DashboardLayout>
  )
}
