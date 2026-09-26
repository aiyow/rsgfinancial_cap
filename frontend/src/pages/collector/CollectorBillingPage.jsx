import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, X } from 'lucide-react'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import NoticeToast from '../../components/NoticeToast'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

const blankPeriod = { periodStart: '', periodEnd: '', dueDate: '', waterRatePerCubicM: 23, associationDuesRatePerSqm: 134.07, latePenaltyPercent: 0 }
const inputClass = 'mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal'
const primaryClass = 'rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300'
const unitNumberCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function Field({ label, children }) {
  return <label className="block text-xs font-bold text-slate-600">{label}{children}</label>
}

function money(value) {
  return `PHP ${Number(value || 0).toFixed(2)}`
}

export default function CollectorBillingPage() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [periods, setPeriods] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [periodForm, setPeriodForm] = useState(blankPeriod)
  const [editingPeriodId, setEditingPeriodId] = useState(null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [readingCount, setReadingCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState({ error: '', message: '' })
  const [generateConfirmOpen, setGenerateConfirmOpen] = useState(false)
  const selectedPeriod = useMemo(() => periods.find((period) => String(period.id) === String(selectedId)), [periods, selectedId])
  const sortedPreviewRows = useMemo(() => [...(preview?.rows || [])].sort((left, right) => unitNumberCollator.compare(String(left.unitNumber), String(right.unitNumber))), [preview])

  const loadPeriods = useCallback(async () => {
    const data = await apiRequest('/api/billing-periods', { token })
    setPeriods(data.periods)
    return data.periods
  }, [token])

  useEffect(() => {
    let active = true
    apiRequest('/api/billing-periods', { token })
      .then((data) => {
        if (!active) return
        setPeriods(data.periods)
        const requested = data.periods.find((period) => String(period.id) === searchParams.get('periodId') && period.status === 'DRAFT')
        if (requested) {
          setSelectedId(String(requested.id))
          setEditingPeriodId(requested.id)
          setPeriodForm({
            periodStart: String(requested.periodStart).slice(0, 10), periodEnd: String(requested.periodEnd).slice(0, 10),
            dueDate: String(requested.dueDate).slice(0, 10), waterRatePerCubicM: Number(requested.waterRatePerCubicM),
            associationDuesRatePerSqm: Number(requested.associationDuesRatePerSqm),
            latePenaltyPercent: Number(requested.latePenaltyPercent || 0),
          })
        }
      })
      .catch((error) => { if (active) setNotice({ error: error.message, message: '' }) })
    return () => { active = false }
  }, [searchParams, token])

  useEffect(() => {
    if (!selectedId) return
    apiRequest(`/api/billing-periods/${selectedId}/readings`, { token })
      .then((data) => setReadingCount(data.readings.length))
      .catch((error) => setNotice({ error: error.message, message: '' }))
  }, [selectedId, token])

  function selectPeriod(value) {
    setSelectedId(value)
    setPreview(null)
    setReadingCount(0)
  }

  function cancelPeriodEdit() {
    setEditingPeriodId(null)
    setPeriodForm(blankPeriod)
  }

  async function savePeriod(event) {
    event.preventDefault()
    setBusy(true)
    setNotice({ error: '', message: '' })
    try {
      const data = await apiRequest(editingPeriodId ? `/api/billing-periods/${editingPeriodId}` : '/api/billing-periods', { method: editingPeriodId ? 'PATCH' : 'POST', token, body: periodForm })
      await loadPeriods()
      selectPeriod(String(data.period.id))
      cancelPeriodEdit()
      setNotice({ error: '', message: editingPeriodId ? 'Draft billing settings updated.' : 'Draft billing period created.' })
    } catch (error) {
      setNotice({ error: error.message, message: '' })
    } finally { setBusy(false) }
  }

  async function previewFile(event) {
    event.preventDefault()
    if (!file || !selectedId) return
    setBusy(true)
    setNotice({ error: '', message: '' })
    try {
      const formData = new FormData()
      formData.append('file', file)
      const data = await apiRequest(`/api/billing-periods/${selectedId}/readings/preview`, { method: 'POST', token, body: formData })
      setPreview(data)
      setNotice(data.valid
        ? { error: '', message: 'Spreadsheet is ready to import.' }
        : { error: 'Fix the validation errors before importing.', message: '' })
    } catch (error) {
      setPreview(null)
      setNotice({ error: error.message, message: '' })
    } finally { setBusy(false) }
  }

  async function importReadings() {
    if (!preview?.valid) return
    setBusy(true)
    setNotice({ error: '', message: '' })
    try {
      const readings = preview.rows.map(({ unitId, previousReading, currentReading }) => ({ unitId, previousReading, currentReading }))
      const data = await apiRequest(`/api/billing-periods/${selectedId}/readings`, { method: 'PUT', token, body: { readings } })
      setReadingCount(readings.length)
      setNotice({ error: '', message: data.message })
    } catch (error) {
      setNotice({ error: error.message, message: '' })
    } finally { setBusy(false) }
  }

  async function generateBills() {
    setGenerateConfirmOpen(false)
    setBusy(true)
    setNotice({ error: '', message: '' })
    try {
      const data = await apiRequest(`/api/billing-periods/${selectedId}/generate`, { method: 'POST', token })
      await loadPeriods()
      setNotice({ error: '', message: data.message })
      navigate(`/collector/bills?billingPeriodId=${selectedId}`)
    } catch (error) {
      setNotice({ error: error.message, message: '' })
    } finally { setBusy(false) }
  }

  return (
    <DashboardLayout title="Monthly billing" description="Create a draft period, validate the Billing Associate workbook, and generate unit bills.">
      <NoticeToast key={notice.error || notice.message || 'empty'} error={notice.error} message={notice.message} />

      <Panel accent="blue" title={editingPeriodId ? '1. Edit draft billing period' : 'Create billing period'} description="The workbook has no dates, so enter the coverage and due date here.">
        <form onSubmit={savePeriod} className="grid gap-3 rounded-xl bg-slate-50 p-4 md:grid-cols-3 xl:grid-cols-[repeat(6,minmax(0,1fr))_auto]">
          <Field label="Period start"><input required type="date" value={periodForm.periodStart} onChange={(event) => setPeriodForm({ ...periodForm, periodStart: event.target.value })} className={inputClass} /></Field>
          <Field label="Period end"><input required type="date" value={periodForm.periodEnd} onChange={(event) => setPeriodForm({ ...periodForm, periodEnd: event.target.value })} className={inputClass} /></Field>
          <Field label="Due date"><input required type="date" value={periodForm.dueDate} onChange={(event) => setPeriodForm({ ...periodForm, dueDate: event.target.value })} className={inputClass} /></Field>
          <Field label="Water rate / m3"><input required min="0" step="0.01" type="number" value={periodForm.waterRatePerCubicM} onChange={(event) => setPeriodForm({ ...periodForm, waterRatePerCubicM: Number(event.target.value) })} className={inputClass} /></Field>
          <Field label="Association rate / sqm"><input required min="0" step="0.01" type="number" value={periodForm.associationDuesRatePerSqm} onChange={(event) => setPeriodForm({ ...periodForm, associationDuesRatePerSqm: Number(event.target.value) })} className={inputClass} /></Field>
          <Field label="Late penalty (%)"><input required min="0" max="100" step="0.01" type="number" value={periodForm.latePenaltyPercent} onChange={(event) => setPeriodForm({ ...periodForm, latePenaltyPercent: Number(event.target.value) })} className={inputClass} /></Field>
          <div className="flex self-end gap-2"><button disabled={busy} className={`${primaryClass} whitespace-nowrap`}>{editingPeriodId ? 'Save settings' : 'Create draft'}</button>{editingPeriodId && <button type="button" onClick={cancelPeriodEdit} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">Cancel</button>}</div>
        </form>
        <p className="mt-3 text-xs text-slate-500">The late penalty is applied once to an unpaid SOA after its due date.</p>
      </Panel>

      <Panel accent="red" title="Upload and validate readings" description="Required columns: UNIT, PREVIOUS, and PRESENT. Server calculations override spreadsheet formulas.">
        <form onSubmit={previewFile} className="grid gap-3 rounded-xl bg-slate-50 p-4 md:grid-cols-[1fr_1fr_auto]">
          <Field label="Draft period"><select required value={selectedId} onChange={(event) => selectPeriod(event.target.value)} className={inputClass}><option value="">Select period</option>{periods.map((period) => <option key={period.id} value={period.id}>{period.periodStart} to {period.periodEnd} - {period.status}</option>)}</select></Field>
          <Field label="Billing Associate workbook"><input required accept=".xlsx" type="file" onChange={(event) => setFile(event.target.files[0] || null)} className={inputClass} /></Field>
          <button disabled={busy || !selectedId} className={`${primaryClass} self-end`}>{selectedPeriod?.status === 'DRAFT' ? 'Preview file' : 'Preview corrected file'}</button>
        </form>
        {readingCount > 0 && <p className="mt-3 text-sm font-bold text-emerald-700">{readingCount} readings are currently saved for this period.</p>}
        {preview && (
          <div className="mt-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600"><span><strong className="text-slate-900">{preview.summary.rowCount}</strong> spreadsheet rows</span><span><strong className="text-slate-900">{preview.summary.unitCount}</strong> database units</span><span className="text-amber-700"><strong>{preview.summary.flaggedCount || 0}</strong> flagged</span><span><strong>{preview.summary.warningCount}</strong> warnings</span><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">Sorted by unit number</span></div><button type="button" disabled={!preview.valid || busy} onClick={importReadings} className={primaryClass}>{selectedPeriod?.status === 'DRAFT' ? 'Confirm import' : 'Apply corrected readings'}</button></div>
            {preview.errors.map((error) => <p key={error} className="mb-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>)}
            {(preview.warnings || []).map((warning) => <p key={warning} className="mb-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{warning}</p>)}
            <div className="max-h-[520px] overflow-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full min-w-[1050px] text-left text-sm"><thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 shadow-sm"><tr><th className="px-4 py-3 whitespace-nowrap">Source row</th><th className="px-4 py-3 whitespace-nowrap">Unit no.</th><th className="px-4 py-3 whitespace-nowrap">Previous</th><th className="px-4 py-3 whitespace-nowrap">Present</th><th className="px-4 py-3 whitespace-nowrap">Consumption</th><th className="px-4 py-3 whitespace-nowrap">Water charge</th><th className="min-w-[360px] px-4 py-3">Validation</th></tr></thead><tbody className="divide-y divide-slate-100">
                {sortedPreviewRows.map((row) => <tr key={row.rowNumber} className={row.errors.length ? 'bg-red-50' : row.validationStatus === 'FLAGGED' ? 'bg-amber-50' : 'hover:bg-slate-50'}><td className="px-4 py-3 text-slate-500">{row.rowNumber}</td><td className="px-4 py-3 font-black tabular-nums text-slate-950">{row.unitNumber}</td><td className="px-4 py-3 tabular-nums">{row.previousReading}</td><td className="px-4 py-3 tabular-nums">{row.currentReading}</td><td className="px-4 py-3 tabular-nums">{row.consumption?.toFixed(3)}</td><td className="px-4 py-3 font-semibold tabular-nums">{money(row.waterCharge)}</td><td className="min-w-[360px] px-4 py-3 leading-5">{row.errors.length ? <span className="font-medium text-red-700">{row.errors.join(' ')}</span> : row.warnings.length ? <span className="font-medium text-amber-700">{row.warnings.join(' ')}</span> : <span className="font-medium text-emerald-700">Valid</span>}</td></tr>)}
              </tbody></table>
            </div>
          </div>
        )}
      </Panel>

      <Panel accent="green" title="Generate bills" description="Creates one bill with water and association-dues charge lines for every unit.">
        {!selectedPeriod ? <EmptyRow message="Select a billing period first." /> : <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-bold">{selectedPeriod.periodStart} to {selectedPeriod.periodEnd}</p><p className="text-sm text-slate-500">Status: {selectedPeriod.status} | Saved readings: {readingCount}</p></div><button disabled={busy || selectedPeriod.status !== 'DRAFT' || readingCount === 0} onClick={() => setGenerateConfirmOpen(true)} className={primaryClass}>Generate bills</button></div>}
      </Panel>
      {generateConfirmOpen && selectedPeriod && <GenerateBillsModal period={selectedPeriod} readingCount={readingCount} busy={busy} onCancel={() => setGenerateConfirmOpen(false)} onConfirm={generateBills} />}
    </DashboardLayout>
  )
}

function GenerateBillsModal({ period, readingCount, busy, onCancel, onConfirm }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-[1px]" role="presentation" onMouseDown={() => { if (!busy) onCancel() }}>
    <section role="dialog" aria-modal="true" aria-labelledby="generate-bills-title" className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl sm:p-6" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4"><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700"><AlertTriangle size={21} aria-hidden="true" /></span><div><h2 id="generate-bills-title" className="text-xl font-black text-slate-900">Generate final bills?</h2><p className="mt-1 text-sm text-slate-600">Please review this batch once more before continuing.</p></div></div><button type="button" disabled={busy} onClick={onCancel} aria-label="Close bill-generation confirmation" className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 disabled:opacity-50"><X size={19} /></button></div>
      <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-slate-700"><p>Generate final Statements of Account for <strong className="text-slate-900">{period.periodStart} to {period.periodEnd}</strong> using the <strong className="text-slate-900">{readingCount} saved meter readings</strong>.</p><p className="mt-2 font-bold text-amber-900">Readings cannot be changed after the bills are generated.</p></div>
      <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" disabled={busy} onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50">Keep editing</button><button type="button" disabled={busy} onClick={onConfirm} className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:opacity-50">{busy ? 'Generating…' : 'Generate final bills'}</button></div>
    </section>
  </div>
}
