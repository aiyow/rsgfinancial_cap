import { useEffect, useMemo, useState } from 'react'
import { Building2, ChevronDown, Search, Users } from 'lucide-react'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

const UNITS_PER_PAGE = 12
const unitNumberCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function occupancyBadge(status) {
  return status === 'OCCUPIED'
    ? 'bg-emerald-100 text-emerald-800'
    : 'bg-amber-100 text-amber-800'
}

export default function CollectorUnitsPage() {
  const { token } = useAuth()
  const [units, setUnits] = useState([])
  const [assignments, setAssignments] = useState([])
  const [search, setSearch] = useState('')
  const [occupancyFilter, setOccupancyFilter] = useState('ALL')
  const [floorFilter, setFloorFilter] = useState('ALL')
  const [occupancyMenuOpen, setOccupancyMenuOpen] = useState(false)
  const [floorMenuOpen, setFloorMenuOpen] = useState(false)
  const [assignmentSearch, setAssignmentSearch] = useState('')
  const [assignmentRelationship, setAssignmentRelationship] = useState('ALL')
  const [assignmentSort, setAssignmentSort] = useState('UNIT')
  const [assignmentRelationshipMenuOpen, setAssignmentRelationshipMenuOpen] = useState(false)
  const [assignmentSortMenuOpen, setAssignmentSortMenuOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
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
      .finally(() => { if (active) setLoading(false) })

    return () => { active = false }
  }, [token])

  const activeAssignments = useMemo(() => assignments.filter((assignment) => !assignment.endDate), [assignments])
  const assignmentRelationships = useMemo(() => [...new Set(activeAssignments.map((assignment) => assignment.relationshipType).filter(Boolean))].sort(unitNumberCollator.compare), [activeAssignments])
  const assignmentsByUnit = useMemo(() => activeAssignments.reduce((grouped, assignment) => {
    const key = String(assignment.unitId)
    const current = grouped.get(key) || []
    current.push(assignment)
    grouped.set(key, current)
    return grouped
  }, new Map()), [activeAssignments])
  const floors = useMemo(() => [...new Set(units.map((unit) => unit.floor).filter(Boolean))].sort(unitNumberCollator.compare), [units])
  const filteredUnits = useMemo(() => {
    const searchTerm = search.trim().toLowerCase()
    return units
      .filter((unit) => {
        const residents = assignmentsByUnit.get(String(unit.id)) || []
        const matchesSearch = !searchTerm || [unit.unitNumber, unit.floor, ...residents.map((assignment) => assignment.residentName)]
          .some((value) => String(value || '').toLowerCase().includes(searchTerm))
        return matchesSearch
          && (occupancyFilter === 'ALL' || unit.occupancyStatus === occupancyFilter)
          && (floorFilter === 'ALL' || unit.floor === floorFilter)
      })
      .sort((left, right) => unitNumberCollator.compare(String(left.unitNumber), String(right.unitNumber)))
  }, [assignmentsByUnit, floorFilter, occupancyFilter, search, units])
  const totalPages = Math.max(1, Math.ceil(filteredUnits.length / UNITS_PER_PAGE))
  const currentPage = Math.min(page, totalPages)
  const firstUnitIndex = (currentPage - 1) * UNITS_PER_PAGE
  const visibleUnits = filteredUnits.slice(firstUnitIndex, firstUnitIndex + UNITS_PER_PAGE)
  const lastUnitIndex = Math.min(firstUnitIndex + UNITS_PER_PAGE, filteredUnits.length)
  const occupiedCount = units.filter((unit) => unit.occupancyStatus === 'OCCUPIED').length
  const filteredAssignments = useMemo(() => {
    const searchTerm = assignmentSearch.trim().toLowerCase()
    const rows = activeAssignments.filter((assignment) => {
      const matchesSearch = !searchTerm || [assignment.residentName, assignment.unitNumber, assignment.relationshipType]
        .some((value) => String(value || '').toLowerCase().includes(searchTerm))
      return matchesSearch && (assignmentRelationship === 'ALL' || assignment.relationshipType === assignmentRelationship)
    })
    return rows.sort((left, right) => {
      if (assignmentSort === 'RESIDENT') return unitNumberCollator.compare(left.residentName || '', right.residentName || '')
      if (assignmentSort === 'RELATIONSHIP') return unitNumberCollator.compare(left.relationshipType || '', right.relationshipType || '') || unitNumberCollator.compare(left.residentName || '', right.residentName || '')
      if (assignmentSort === 'PAYER') return Number(right.isPrimaryPayer) - Number(left.isPrimaryPayer) || unitNumberCollator.compare(String(left.unitNumber), String(right.unitNumber))
      return unitNumberCollator.compare(String(left.unitNumber), String(right.unitNumber)) || unitNumberCollator.compare(left.residentName || '', right.residentName || '')
    })
  }, [activeAssignments, assignmentRelationship, assignmentSearch, assignmentSort])

  function resetPage(update) {
    update()
    setPage(1)
  }

  return (
    <DashboardLayout title="Units" description="Search the condominium directory and review resident assignments.">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Total units" value={units.length} icon={Building2} accent="blue" />
        <SummaryCard label="Occupied" value={occupiedCount} icon={Users} accent="green" />
        <SummaryCard label="Vacant" value={units.length - occupiedCount} icon={Building2} accent="red" />
        <SummaryCard label="Active assignments" value={activeAssignments.length} icon={Users} accent="blue" />
      </div>

      <Panel title="Unit directory" description="Read-only records. Search by unit, floor, or resident name.">
        <div className="mb-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_180px]">
          <label className="block text-xs font-bold text-slate-600">Search directory<div className="relative mt-1"><Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => resetPage(() => setSearch(event.target.value))} placeholder="Unit, floor, or resident name" className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm font-normal" /></div></label>
          <FilterPopover label="Occupancy" value={occupancyFilter} open={occupancyMenuOpen} onToggle={() => { setOccupancyMenuOpen((current) => !current); setFloorMenuOpen(false) }} onSelect={(value) => { resetPage(() => setOccupancyFilter(value)); setOccupancyMenuOpen(false) }} options={[{ value: 'ALL', label: 'All units' }, { value: 'OCCUPIED', label: 'Occupied' }, { value: 'VACANT', label: 'Vacant' }]} />
          <FilterPopover label="Floor" value={floorFilter} open={floorMenuOpen} onToggle={() => { setFloorMenuOpen((current) => !current); setOccupancyMenuOpen(false) }} onSelect={(value) => { resetPage(() => setFloorFilter(value)); setFloorMenuOpen(false) }} options={[{ value: 'ALL', label: 'All floors' }, ...floors.map((floor) => ({ value: floor, label: floor }))]} />
        </div>

        {!loading && <p className="mb-3 text-sm text-slate-500">Showing {filteredUnits.length ? `${firstUnitIndex + 1}-${lastUnitIndex}` : 0} of {filteredUnits.length} matching units ({units.length} total).</p>}
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {visibleUnits.map((unit) => {
            const residents = assignmentsByUnit.get(String(unit.id)) || []
            return <article key={unit.id} className="rounded-xl border border-slate-200 bg-white p-3 transition hover:border-emerald-200 hover:shadow-sm"><div className="flex items-start justify-between gap-2"><div><h2 className="text-sm font-black text-slate-900">Unit {unit.unitNumber}</h2><p className="mt-0.5 text-[11px] text-slate-500">{unit.floor || 'Floor not set'}</p></div><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${occupancyBadge(unit.occupancyStatus)}`}>{unit.occupancyStatus}</span></div><dl className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-2 text-xs"><div><dt className="text-[11px] text-slate-500">Billable area</dt><dd className="mt-0.5 font-bold">{unit.billableAreaSqm ?? 'Not set'}{unit.billableAreaSqm ? ' sqm' : ''}</dd></div><div><dt className="text-[11px] text-slate-500">Active residents</dt><dd className="mt-0.5 font-bold">{residents.length}</dd></div></dl><div className="mt-2 min-h-8 border-t border-slate-100 pt-2 text-[11px] leading-4 text-slate-600">{residents.length ? residents.map((assignment) => <p key={assignment.id} className="truncate"><span className="font-bold text-slate-800">{assignment.residentName}</span> · {assignment.relationshipType.toLowerCase()}{assignment.isPrimaryPayer ? ' · Primary payer' : ''}</p>) : 'No active resident assignment'}</div></article>
          })}
        </div>
        {loading && <p className="py-8 text-center text-sm text-slate-500">Loading unit directory...</p>}
        {!loading && filteredUnits.length === 0 && <EmptyRow message={units.length ? 'No units match the selected filters.' : 'No units available.'} />}
        {filteredUnits.length > 0 && <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-500">Page {currentPage} of {totalPages}</p><div className="flex gap-2"><button type="button" disabled={currentPage === 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50">Previous</button><button type="button" disabled={currentPage === totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50">Next</button></div></div>}
      </Panel>

      <Panel title="Active resident assignments" description="Residents currently linked to a condominium unit.">
        <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_190px_190px]"><label className="block text-xs font-bold text-slate-600">Search assignments<div className="relative mt-1"><Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={assignmentSearch} onChange={(event) => setAssignmentSearch(event.target.value)} placeholder="Resident, unit, or relationship" className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm font-normal" /></div></label><FilterPopover label="Relationship" value={assignmentRelationship} open={assignmentRelationshipMenuOpen} onToggle={() => { setAssignmentRelationshipMenuOpen((current) => !current); setAssignmentSortMenuOpen(false) }} onSelect={(value) => { setAssignmentRelationship(value); setAssignmentRelationshipMenuOpen(false) }} options={[{ value: 'ALL', label: 'All relationships' }, ...assignmentRelationships.map((relationship) => ({ value: relationship, label: `${relationship.charAt(0)}${relationship.slice(1).toLowerCase()}` }))]} /><FilterPopover label="Sort by" value={assignmentSort} open={assignmentSortMenuOpen} onToggle={() => { setAssignmentSortMenuOpen((current) => !current); setAssignmentRelationshipMenuOpen(false) }} onSelect={(value) => { setAssignmentSort(value); setAssignmentSortMenuOpen(false) }} options={[{ value: 'UNIT', label: 'Unit number' }, { value: 'RESIDENT', label: 'Resident name' }, { value: 'RELATIONSHIP', label: 'Relationship' }, { value: 'PAYER', label: 'Primary payer first' }]} /></div>
        {!loading && <p className="mb-3 text-sm text-slate-500">Showing {filteredAssignments.length} of {activeAssignments.length} active assignments.</p>}
        <div className="max-h-[400px] overflow-auto rounded-xl border border-slate-100"><table className="w-full min-w-[700px] text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Resident</th><th className="px-4 py-3">Unit</th><th className="px-4 py-3">Relationship</th><th className="px-4 py-3">Payer</th></tr></thead><tbody className="divide-y divide-slate-300">{filteredAssignments.map((assignment) => <tr key={assignment.id} className="hover:bg-slate-50"><td className="px-4 py-3 font-bold">{assignment.residentName}</td><td className="px-4 py-3">Unit {assignment.unitNumber}</td><td className="px-4 py-3 capitalize">{assignment.relationshipType.toLowerCase()}</td><td className="px-4 py-3">{assignment.isPrimaryPayer ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">Primary payer</span> : <span className="text-slate-500">—</span>}</td></tr>)}</tbody></table></div>
        {!loading && activeAssignments.length === 0 && <EmptyRow message="No active resident assignments." />}
        {!loading && activeAssignments.length > 0 && filteredAssignments.length === 0 && <EmptyRow message="No active assignments match these filters." />}
      </Panel>
    </DashboardLayout>
  )
}

function SummaryCard({ accent, icon: Icon, label, value }) {
  return <article className={`collector-metric collector-metric-${accent} rounded-xl border border-slate-200 p-4 shadow-sm`}><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-2xl font-black text-[var(--ink)]">{value}</p></div><span className="grid size-10 place-items-center rounded-xl"><Icon size={19} /></span></div></article>
}

function FilterPopover({ label, onSelect, onToggle, open, options, value }) {
  const selected = options.find((option) => option.value === value) || options[0]

  return (
    <div className="relative min-w-0">
      <p className="text-xs font-bold text-slate-600">{label}</p>
      <button type="button" aria-expanded={open} onClick={onToggle} className="mt-1 flex min-h-[42px] w-full items-center justify-between gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-left text-sm font-normal text-slate-700 outline-none transition hover:border-[#2f8f5b]">
        <span className="truncate">{selected.label}</span>
        <ChevronDown size={17} className={`shrink-0 text-slate-500 transition ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute inset-x-0 top-[calc(100%+8px)] z-30 max-h-60 overflow-y-auto rounded-xl border border-[#d7eadc] bg-white p-3 shadow-xl">
          <div className="grid gap-1">
            {options.map((option) => <button key={option.value} type="button" onClick={() => onSelect(option.value)} className={`rounded-lg px-2.5 py-2 text-left text-xs font-bold transition ${value === option.value ? 'bg-[#2f8f5b] text-white' : 'text-[#466653] hover:bg-[#effaf2] hover:text-[#2f8f5b]'}`}>{option.label}</button>)}
          </div>
        </div>
      )}
    </div>
  )
}
