import { useEffect, useMemo, useState } from 'react'
import { FileSpreadsheet, RotateCcw, Trash2, Upload } from 'lucide-react'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

const inputClass = 'mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal'
const primaryClass = 'inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300'
const outlineClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50'
const dangerClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 px-3 py-2.5 text-sm font-bold text-red-700 disabled:cursor-not-allowed disabled:opacity-50'

function monthLabel(value) {
  return value ? new Date(`${String(value).slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'No month'
}

function money(value) {
  return `PHP ${Number(value || 0).toFixed(2)}`
}

function number(value, digits = 3) {
  return value === null || value === undefined ? '-' : Number(value).toFixed(digits)
}

function Field({ label, children }) {
  return <label className="block text-xs font-bold text-slate-600">{label}{children}</label>
}

export default function CollectorHistoryImportPage() {
  const { token } = useAuth()
  const [periodMonth, setPeriodMonth] = useState('')
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [imports, setImports] = useState([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState({ error: '', message: '' })

  const sortedImports = useMemo(() => [...imports].sort((a, b) => String(b.periodMonth).localeCompare(String(a.periodMonth))), [imports])

  async function loadImports() {
    const data = await apiRequest('/api/analytics/imports', { token })
    setImports(data.imports || [])
  }

  useEffect(() => {
    let active = true
    apiRequest('/api/analytics/imports', { token })
      .then((data) => {
        if (active) setImports(data.imports || [])
      })
      .catch((error) => {
        if (active) setNotice({ error: error.message, message: '' })
      })

    return () => {
      active = false
    }
  }, [token])

  async function previewFile(event) {
    event.preventDefault()
    if (!periodMonth || !file) return
    setBusy(true)
    setNotice({ error: '', message: '' })
    try {
      const formData = new FormData()
      formData.append('periodMonth', periodMonth)
      formData.append('file', file)
      const data = await apiRequest('/api/analytics/imports/preview', { method: 'POST', token, body: formData })
      setPreview(data)
      setNotice({ error: '', message: data.valid ? (data.usesExistingLiveBilling ? 'Workbook is ready to verify against the saved billing batch.' : 'Workbook is ready to import.') : 'Fix the validation errors before importing.' })
    } catch (error) {
      setPreview(null)
      setNotice({ error: error.message, message: '' })
    } finally { setBusy(false) }
  }

  async function importPreview() {
    if (!preview?.valid) return
    setBusy(true)
    setNotice({ error: '', message: '' })
    try {
      const readings = preview.rows.map(({ unitId, previousReading, currentReading }) => ({ unitId, previousReading, currentReading }))
      const data = await apiRequest('/api/analytics/imports', {
        method: 'POST',
        token,
        body: { periodMonth: preview.periodMonth, waterRatePerCubicM: preview.waterRate, readings },
      })
      await loadImports()
      setPreview(null)
      setFile(null)
      setNotice({ error: '', message: data.message })
    } catch (error) {
      setNotice({ error: error.message, message: '' })
    } finally { setBusy(false) }
  }

  async function deleteMonth(month) {
    if (!window.confirm(`Remove imported analytics data for ${monthLabel(month)}?`)) return
    setBusy(true)
    setNotice({ error: '', message: '' })
    try {
      const data = await apiRequest(`/api/analytics/imports/${month}`, { method: 'DELETE', token })
      await loadImports()
      setNotice({ error: '', message: data.message })
    } catch (error) {
      setNotice({ error: error.message, message: '' })
    } finally { setBusy(false) }
  }

  async function clearAll() {
    if (!window.confirm('Clear all imported analytics history? Real billing, SOAs, payments, users, and units will stay unchanged.')) return
    setBusy(true)
    setNotice({ error: '', message: '' })
    try {
      const data = await apiRequest('/api/analytics/imports', { method: 'DELETE', token })
      await loadImports()
      setPreview(null)
      setNotice({ error: '', message: data.message })
    } catch (error) {
      setNotice({ error: error.message, message: '' })
    } finally { setBusy(false) }
  }

  return (
    <DashboardLayout title="Analytics history import" description="Import past monthly meter readings for predictive water analytics.">
      {(notice.error || notice.message) && <p className={`rounded-lg p-3 text-sm ${notice.error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{notice.error || notice.message}</p>}

      <Panel title="Upload monthly history" description="Select the billing month, upload the cleaned Excel workbook, preview the readings, then confirm the import.">
        <form onSubmit={previewFile} className="grid gap-3 rounded-xl bg-slate-50 p-4 md:grid-cols-[220px_1fr_auto]">
          <Field label="Billing month">
            <input required type="month" value={periodMonth} onChange={(event) => { setPeriodMonth(event.target.value); setPreview(null) }} className={inputClass} />
          </Field>
          <Field label="Excel file">
            <input required accept=".xlsx" type="file" onChange={(event) => { setFile(event.target.files[0] || null); setPreview(null) }} className={inputClass} />
          </Field>
          <button disabled={busy || !periodMonth || !file} className={`${primaryClass} self-end`}>
            <FileSpreadsheet size={16} /> Preview
          </button>
        </form>
      </Panel>

      <Panel title="Preview readings" description="Required columns: UNIT, PREVIOUS, PRESENT, CONSUMPTION, WRATE, and WATER BILLED.">
        {!preview ? <EmptyRow message="No workbook preview yet." /> : (
          <div>
            <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Metric label="Month" value={monthLabel(preview.periodMonth)} />
              <Metric label="Rows" value={preview.summary.rowCount} />
              <Metric label="Units" value={preview.summary.unitCount} />
              <Metric label="Errors" value={preview.summary.errorCount} tone={preview.summary.errorCount ? 'red' : 'slate'} />
              <Metric label="Warnings" value={preview.summary.warningCount} tone={preview.summary.warningCount ? 'amber' : 'slate'} />
            </div>
            {preview.errors.map((error) => <p key={error} className="mb-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>)}
            {preview.warnings.map((warning) => <p key={warning} className="mb-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{warning}</p>)}
            {preview.usesExistingLiveBilling && <p className="mb-4 rounded-lg bg-sky-50 p-3 text-sm text-sky-800">A live billing batch already exists for this month. Confirming will verify this workbook and refresh forecasts without changing saved billing readings.</p>}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-500">Water rate: <strong className="text-slate-900">{money(preview.waterRate)}</strong></p>
              <button type="button" disabled={busy || !preview.valid} onClick={importPreview} className={primaryClass}>
                <Upload size={16} /> {preview.usesExistingLiveBilling ? 'Verify and refresh' : 'Confirm import'}
              </button>
            </div>
            <div className="max-h-[520px] overflow-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead className="sticky top-0 bg-white text-xs uppercase text-slate-400"><tr><th className="p-3">Row</th><th>Unit</th><th>Previous</th><th>Present</th><th>Consumption</th><th>Water charge</th><th>Validation</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.rows.map((row) => (
                    <tr key={row.rowNumber} className={row.errors.length ? 'bg-red-50' : row.warnings.length ? 'bg-amber-50' : ''}>
                      <td className="p-3">{row.rowNumber}</td>
                      <td className="font-bold">{row.unitNumber}</td>
                      <td>{number(row.previousReading)}</td>
                      <td>{number(row.currentReading)}</td>
                      <td>{number(row.consumption)}</td>
                      <td>{money(row.waterCharge)}</td>
                      <td>{row.errors.length ? <span className="text-red-700">{row.errors.join(' ')}</span> : row.warnings.length ? <span className="text-amber-700">{row.warnings.join(' ')}</span> : <span className="text-emerald-700">Ready</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Imported analytics months" description="These imports feed predictive analytics only. They do not create SOAs or change real billing records.">
        <div className="mb-4 flex justify-end">
          <button type="button" disabled={busy || sortedImports.length === 0} onClick={clearAll} className={dangerClass}>
            <RotateCcw size={16} /> Clear all imports
          </button>
        </div>
        {sortedImports.length ? (
          <div className="overflow-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-400"><tr><th className="p-3">Month</th><th>Readings</th><th>Flagged</th><th>Forecast month</th><th>Ready forecasts</th><th></th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {sortedImports.map((item) => (
                  <tr key={item.periodMonth}>
                    <td className="p-3 font-bold">{monthLabel(item.periodMonth)}</td>
                    <td>{item.readingCount}</td>
                    <td>{item.flaggedCount}</td>
                    <td>{item.forecastForMonth ? monthLabel(item.forecastForMonth) : '-'}</td>
                    <td>{item.readyForecastCount}</td>
                    <td className="text-right"><button type="button" disabled={busy} onClick={() => deleteMonth(item.periodMonth)} className={outlineClass}><Trash2 size={16} /> Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyRow message="No analytics data yet. Import historical readings first." />}
      </Panel>
    </DashboardLayout>
  )
}

function Metric({ label, value, tone = 'slate' }) {
  const toneClass = tone === 'red' ? 'text-red-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-950'
  return <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p><p className={`mt-2 text-xl font-black ${toneClass}`}>{value}</p></div>
}
