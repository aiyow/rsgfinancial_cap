import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

const blankPeriod = { periodStart: '', periodEnd: '', dueDate: '', waterRatePerCubicM: 23, associationDuesRatePerSqm: 134.07 }
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

  function startEditPeriod(period) {
    if (!period || period.status !== 'DRAFT') return
    setEditingPeriodId(period.id)
    setPeriodForm({
      periodStart: String(period.periodStart).slice(0, 10), periodEnd: String(period.periodEnd).slice(0, 10),
      dueDate: String(period.dueDate).slice(0, 10), waterRatePerCubicM: Number(period.waterRatePerCubicM),
      associationDuesRatePerSqm: Number(period.associationDuesRatePerSqm),
    })
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
      setNotice({ error: '', message: data.valid ? 'Spreadsheet is ready to import.' : 'Fix the validation errors before importing.' })
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
    if (!window.confirm('Generate final bills for this period? Readings cannot be changed afterward.')) return
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
    <DashboardLayout title="Monthly billing" description="Create a draft period, validate the Collector workbook, and generate unit bills.">
      {(notice.error || notice.message) && <p className={`rounded-lg p-3 text-sm ${notice.error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{notice.error || notice.message}</p>}

      <Panel title={editingPeriodId ? '1. Edit draft billing period' : '1. Create billing period'} description="The workbook has no dates, so enter the coverage and due date here.">
        <form onSubmit={savePeriod} className="grid gap-3 rounded-xl bg-slate-50 p-4 md:grid-cols-6">
          <Field label="Period start"><input required type="date" value={periodForm.periodStart} onChange={(event) => setPeriodForm({ ...periodForm, periodStart: event.target.value })} className={inputClass} /></Field>
          <Field label="Period end"><input required type="date" value={periodForm.periodEnd} onChange={(event) => setPeriodForm({ ...periodForm, periodEnd: event.target.value })} className={inputClass} /></Field>
          <Field label="Due date"><input required type="date" value={periodForm.dueDate} onChange={(event) => setPeriodForm({ ...periodForm, dueDate: event.target.value })} className={inputClass} /></Field>
          <Field label="Water rate / m3"><input required min="0" step="0.01" type="number" value={periodForm.waterRatePerCubicM} onChange={(event) => setPeriodForm({ ...periodForm, waterRatePerCubicM: Number(event.target.value) })} className={inputClass} /></Field>
          <Field label="Association rate / sqm"><input required min="0" step="0.01" type="number" value={periodForm.associationDuesRatePerSqm} onChange={(event) => setPeriodForm({ ...periodForm, associationDuesRatePerSqm: Number(event.target.value) })} className={inputClass} /></Field>
          <div className="flex self-end gap-2"><button disabled={busy} className={primaryClass}>{editingPeriodId ? 'Save settings' : 'Create draft'}</button>{editingPeriodId && <button type="button" onClick={cancelPeriodEdit} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">Cancel</button>}</div>
        </form>
      </Panel>

      <Panel title="2. Upload and validate readings" description="Required columns: UNIT, PREVIOUS, and PRESENT. Server calculations override spreadsheet formulas.">
        <form onSubmit={previewFile} className="grid gap-3 rounded-xl bg-slate-50 p-4 md:grid-cols-[1fr_1fr_auto_auto]">
          <Field label="Draft period"><select required value={selectedId} onChange={(event) => selectPeriod(event.target.value)} className={inputClass}><option value="">Select period</option>{periods.map((period) => <option key={period.id} value={period.id}>{period.periodStart} to {period.periodEnd} - {period.status}</option>)}</select></Field>
          <Field label="Collector workbook"><input required accept=".xlsx" type="file" onChange={(event) => setFile(event.target.files[0] || null)} className={inputClass} /></Field>
          <button type="button" disabled={!selectedPeriod || selectedPeriod.status !== 'DRAFT'} onClick={() => startEditPeriod(selectedPeriod)} className="self-end rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-bold disabled:opacity-50">Edit settings</button>
          <button disabled={busy || !selectedId || selectedPeriod?.status !== 'DRAFT'} className={`${primaryClass} self-end`}>Preview file</button>
        </form>
        {readingCount > 0 && <p className="mt-3 text-sm font-bold text-emerald-700">{readingCount} readings are currently saved for this period.</p>}
        {preview && (
          <div className="mt-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600"><span><strong className="text-slate-900">{preview.summary.rowCount}</strong> spreadsheet rows</span><span><strong className="text-slate-900">{preview.summary.unitCount}</strong> database units</span><span className="text-amber-700"><strong>{preview.summary.flaggedCount || 0}</strong> flagged</span><span><strong>{preview.summary.warningCount}</strong> warnings</span><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">Sorted by unit number</span></div><button type="button" disabled={!preview.valid || busy} onClick={importReadings} className={primaryClass}>Confirm import</button></div>
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

      <Panel title="3. Generate bills" description="Creates one bill with water and association-dues charge lines for every unit.">
        {!selectedPeriod ? <EmptyRow message="Select a billing period first." /> : <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-bold">{selectedPeriod.periodStart} to {selectedPeriod.periodEnd}</p><p className="text-sm text-slate-500">Status: {selectedPeriod.status} | Saved readings: {readingCount}</p></div><button disabled={busy || selectedPeriod.status !== 'DRAFT' || readingCount === 0} onClick={generateBills} className={primaryClass}>Generate bills</button></div>}
      </Panel>
    </DashboardLayout>
  )
}
