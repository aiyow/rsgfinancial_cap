import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

const PAGE_SIZE = 15
const controlClass = 'rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100'

function SummaryCard({ label, value, tone = 'indigo' }) {
  const tones = {
    indigo: 'bg-indigo-50 text-indigo-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    slate: 'bg-slate-100 text-slate-700',
    amber: 'bg-amber-50 text-amber-700',
  }
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div><p className="text-sm font-bold text-slate-500">{label}</p><p className="mt-2 text-3xl font-black text-slate-950">{value}</p></div>
        <span className={`grid size-11 place-items-center rounded-xl text-lg font-black ${tones[tone]}`}>#</span>
      </div>
    </article>
  )
}

function StatusBadge({ status }) {
  const occupied = status === 'OCCUPIED'
  return <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${occupied ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{occupied ? 'Occupied' : 'Vacant'}</span>
}

export default function AdminUnitsViewPage() {
  const { token } = useAuth()
  const [units, setUnits] = useState([])
  const [assignments, setAssignments] = useState([])
  const [search, setSearch] = useState('')
  const [floor, setFloor] = useState('ALL')
  const [status, setStatus] = useState('ALL')
  const [page, setPage] = useState(1)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([apiRequest('/api/units', { token }), apiRequest('/api/unit-assignments', { token })])
      .then(([unitData, assignmentData]) => {
        if (!active) return
        setUnits(unitData.units)
        setAssignments(assignmentData.assignments)
      })
      .catch((requestError) => { if (active) setError(requestError.message) })
    return () => { active = false }
  }, [token])

  const directory = useMemo(() => {
    const assignmentsByUnit = new Map()
    assignments
      .filter((assignment) => !assignment.endDate)
      .sort((a, b) => Number(b.isPrimaryPayer) - Number(a.isPrimaryPayer))
      .forEach((assignment) => {
        const current = assignmentsByUnit.get(assignment.unitId) || []
        current.push(assignment)
        assignmentsByUnit.set(assignment.unitId, current)
      })
    return units
      .map((unit) => ({ ...unit, activeAssignments: assignmentsByUnit.get(unit.id) || [] }))
      .sort((a, b) => String(a.unitNumber).localeCompare(String(b.unitNumber), undefined, { numeric: true }))
  }, [assignments, units])

  const floors = useMemo(() => [...new Set(units.map((unit) => unit.floor).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })), [units])

  const filteredUnits = useMemo(() => {
    const term = search.trim().toLowerCase()
    return directory.filter((unit) => {
      const searchable = [unit.unitNumber, unit.floor, ...unit.activeAssignments.flatMap((assignment) => [assignment.residentName, assignment.residentEmail, assignment.relationshipType])]
        .filter(Boolean).join(' ').toLowerCase()
      return (!term || searchable.includes(term))
        && (floor === 'ALL' || String(unit.floor) === floor)
        && (status === 'ALL' || unit.occupancyStatus === status)
    })
  }, [directory, floor, search, status])

  const totalPages = Math.max(1, Math.ceil(filteredUnits.length / PAGE_SIZE))
  const visibleUnits = filteredUnits.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const firstResult = filteredUnits.length ? (page - 1) * PAGE_SIZE + 1 : 0
  const lastResult = Math.min(page * PAGE_SIZE, filteredUnits.length)
  const occupiedCount = units.filter((unit) => unit.occupancyStatus === 'OCCUPIED').length
  const assignedCount = directory.filter((unit) => unit.activeAssignments.length > 0).length

  function updateSearch(value) { setSearch(value); setPage(1) }
  function updateFloor(value) { setFloor(value); setPage(1) }
  function updateStatus(value) { setStatus(value); setPage(1) }

  return (
    <DashboardLayout title="Unit directory" description="View condominium units, occupancy, sizes, and active residents.">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Total units" value={units.length} />
        <SummaryCard label="Occupied" value={occupiedCount} tone="emerald" />
        <SummaryCard label="Vacant" value={units.length - occupiedCount} tone="slate" />
        <SummaryCard label="With active residents" value={assignedCount} tone="amber" />
      </div>

      <Panel title="All units" description={`Search and filter all ${units.length} condominium units.`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <input type="search" value={search} onChange={(event) => updateSearch(event.target.value)} placeholder="Search unit or resident..." aria-label="Search units" className={`${controlClass} min-w-0 flex-1`} />
          <select value={floor} onChange={(event) => updateFloor(event.target.value)} aria-label="Filter by floor" className={controlClass}>
            <option value="ALL">All floors</option>
            {floors.map((floorOption) => <option key={floorOption} value={floorOption}>Floor {floorOption}</option>)}
          </select>
          <select value={status} onChange={(event) => updateStatus(event.target.value)} aria-label="Filter by occupancy" className={controlClass}>
            <option value="ALL">All statuses</option><option value="OCCUPIED">Occupied</option><option value="VACANT">Vacant</option>
          </select>
          <Link to="/admin/units/manage" className="rounded-lg bg-indigo-600 px-4 py-2.5 text-center text-sm font-bold text-white hover:bg-indigo-700">Manage units</Link>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
              <tr><th className="px-3 py-3">Unit</th><th className="px-3 py-3">Floor</th><th className="px-3 py-3">Size</th><th className="px-3 py-3">Resident</th><th className="px-3 py-3">Relationship</th><th className="px-3 py-3">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleUnits.map((unit) => (
                <tr key={unit.id} className="hover:bg-slate-50">
                  <td className="px-3 py-4 font-black text-slate-900">Unit {unit.unitNumber}</td>
                  <td className="px-3 py-4 text-slate-600">{unit.floor || '—'}</td>
                  <td className="px-3 py-4 text-slate-600">{unit.billableAreaSqm ? `${unit.billableAreaSqm} sqm` : 'Not set'}</td>
                  <td className="px-3 py-4 text-slate-700">{unit.activeAssignments.length ? unit.activeAssignments.map((assignment) => assignment.residentName).join(', ') : '—'}</td>
                  <td className="px-3 py-4 text-slate-600">{unit.activeAssignments.length ? unit.activeAssignments.map((assignment) => assignment.relationshipType).join(', ') : '—'}</td>
                  <td className="px-3 py-4"><StatusBadge status={unit.occupancyStatus} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!error && visibleUnits.length === 0 && <div className="mt-4"><EmptyRow message="No units match your search and filters." /></div>}
        </div>

        <div className="mt-5 flex flex-col gap-3 border-t border-slate-200 pt-5 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-slate-500">Showing {firstResult} to {lastResult} of {filteredUnits.length} units</p>
          <div className="flex items-center gap-3">
            <button type="button" disabled={page === 1} onClick={() => setPage((current) => current - 1)} className="rounded-lg border border-slate-300 px-3 py-2 font-bold text-slate-600 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
            <span className="font-bold text-slate-700">Page {page} of {totalPages}</span>
            <button type="button" disabled={page === totalPages} onClick={() => setPage((current) => current + 1)} className="rounded-lg border border-slate-300 px-3 py-2 font-bold text-slate-600 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
          </div>
        </div>
      </Panel>
    </DashboardLayout>
  )
}
