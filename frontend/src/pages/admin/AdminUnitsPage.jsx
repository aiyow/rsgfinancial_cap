import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

const blankUnit = { unitNumber: '', floor: '', billableAreaSqm: '', occupancyStatus: 'VACANT' }
const inputClass = 'mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal'
const actionClass = 'rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50'

function Field({ label, children }) {
  return <label className="block text-xs font-bold text-slate-600">{label}{children}</label>
}

export default function AdminUnitsPage() {
  const { token } = useAuth()
  const [units, setUnits] = useState([])
  const [form, setForm] = useState(blankUnit)
  const [editingId, setEditingId] = useState(null)
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState({ error: '', message: '' })
  const formRef = useRef(null)

  const filteredUnits = useMemo(() => {
    const term = search.trim().toLowerCase().replace(/^unit\s*/, '')
    if (!term) return units
    return units.filter((unit) => String(unit.unitNumber).toLowerCase().includes(term))
  }, [search, units])

  const loadUnits = useCallback(async () => {
    const data = await apiRequest('/api/units', { token })
    setUnits(data.units)
  }, [token])

  useEffect(() => {
    let active = true
    apiRequest('/api/units', { token })
      .then((data) => { if (active) setUnits(data.units) })
      .catch((error) => { if (active) setNotice({ error: error.message, message: '' }) })
    return () => { active = false }
  }, [token])

  async function runAction(action, message) {
    setNotice({ error: '', message: '' })
    try {
      await action()
      await loadUnits()
      setNotice({ error: '', message })
      return true
    } catch (error) {
      setNotice({ error: error.message, message: '' })
      return false
    }
  }

  async function saveUnit(event) {
    event.preventDefault()
    const saved = await runAction(
      () => apiRequest(editingId ? `/api/units/${editingId}` : '/api/units', { method: editingId ? 'PATCH' : 'POST', token, body: form }),
      editingId ? 'Unit updated.' : 'Unit created.',
    )
    if (saved) cancelEdit()
  }

  function startEdit(unit) {
    setEditingId(unit.id)
    setForm({ unitNumber: unit.unitNumber, floor: unit.floor, billableAreaSqm: unit.billableAreaSqm ?? '', occupancyStatus: unit.occupancyStatus })
    setNotice({ error: '', message: `Editing Unit ${unit.unitNumber}. Update the fields and select Save changes.` })
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(blankUnit)
  }

  return (
    <DashboardLayout title="Manage units" description="Create, edit, delete, and update condominium unit records.">
      {(notice.error || notice.message) && <p className={`rounded-lg p-3 text-sm ${notice.error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{notice.error || notice.message}</p>}
      <Panel title="Units" description="Create units and update occupancy.">
        <div ref={formRef} className="scroll-mt-6">
        {editingId && <div className="mb-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm font-bold text-indigo-700">Editing Unit {form.unitNumber}</div>}
        <form onSubmit={saveUnit} className="grid gap-3 rounded-xl bg-slate-50 p-4 md:grid-cols-5">
          <Field label="Unit number"><input required value={form.unitNumber} onChange={(event) => setForm({ ...form, unitNumber: event.target.value })} className={inputClass} /></Field>
          <Field label="Floor"><input required value={form.floor} onChange={(event) => setForm({ ...form, floor: event.target.value })} className={inputClass} /></Field>
          <Field label="Billable area (sqm)"><input required min="0.01" step="0.01" type="number" value={form.billableAreaSqm} onChange={(event) => setForm({ ...form, billableAreaSqm: event.target.value })} className={inputClass} /></Field>
          <Field label="Occupancy"><select value={form.occupancyStatus} onChange={(event) => setForm({ ...form, occupancyStatus: event.target.value })} className={inputClass}><option value="VACANT">Vacant</option><option value="OCCUPIED">Occupied</option></select></Field>
          <div className="flex self-end gap-2"><button className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white">{editingId ? 'Save changes' : 'Add unit'}</button>{editingId && <button type="button" onClick={cancelEdit} className={actionClass}>Cancel</button>}</div>
        </form>
        </div>
        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <label htmlFor="manage-unit-search" className="text-sm font-black text-slate-900">Find a unit</label>
              <p className="mt-1 text-xs text-slate-500">Search using the condominium unit number only.</p>
            </div>
            <p className="text-xs font-bold text-slate-500">{filteredUnits.length} of {units.length} units</p>
          </div>
          <div className="relative mt-3 max-w-2xl">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-slate-400">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
            </svg>
            <input
              id="manage-unit-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Enter unit number, e.g. 220"
              className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-11 pr-20 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
            />
            {search && <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-3 py-1.5 text-xs font-bold text-indigo-600 hover:bg-indigo-50">Clear</button>}
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredUnits.map((unit) => (
            <article key={unit.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex justify-between gap-3"><div><p className="font-black">Unit {unit.unitNumber}</p><p className="text-xs text-slate-500">Floor {unit.floor} - {unit.billableAreaSqm ?? 'Area not set'} sqm</p></div><span className="text-xs font-bold text-slate-500">{unit.occupancyStatus}</span></div>
              <div className="mt-4 space-x-2">
                <button className={actionClass} onClick={() => startEdit(unit)}>Edit</button>
                <button className={actionClass} onClick={() => runAction(() => apiRequest(`/api/units/${unit.id}`, { method: 'PATCH', token, body: { occupancyStatus: unit.occupancyStatus === 'VACANT' ? 'OCCUPIED' : 'VACANT' } }), 'Unit updated.')}>Toggle</button>
                <button className={`${actionClass} text-red-600`} onClick={() => window.confirm('Delete this unit?') && runAction(() => apiRequest(`/api/units/${unit.id}`, { method: 'DELETE', token }), 'Unit deleted.')}>Delete</button>
              </div>
            </article>
          ))}
        </div>
        {filteredUnits.length === 0 && <EmptyRow message={units.length ? 'No units match your search.' : 'No units found.'} />}
      </Panel>
    </DashboardLayout>
  )
}
