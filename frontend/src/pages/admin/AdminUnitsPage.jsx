import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Search, X } from 'lucide-react'
import DashboardLayout, { EmptyRow } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

const blankUnit = { unitNumber: '', floor: '', billableAreaSqm: '', occupancyStatus: 'VACANT' }
const blankAssignment = { userId: '', relationshipType: 'OWNER', isPrimaryPayer: false }
const inputClass = 'mt-1.5 w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--active-bg)]'
const actionClass = 'rounded-md border border-[var(--border)] bg-white px-2.5 py-1.5 text-xs font-bold text-[var(--ink)] transition hover:border-[var(--primary)] hover:bg-[var(--app-bg)]'

function money(value) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0))
}

function date(value) {
  return value ? new Date(`${String(value).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC' }) : '-'
}

function Field({ label, children }) {
  return <label className="block text-xs font-bold text-[var(--muted)]">{label}{children}</label>
}

function OccupancyBadge({ status }) {
  const occupied = status === 'OCCUPIED'
  return <span className={`inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-xs font-bold ${occupied ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}><span className={`size-1.5 rounded-full ${occupied ? 'bg-emerald-500' : 'bg-slate-400'}`} />{occupied ? 'Occupied' : 'Vacant'}</span>
}

export default function AdminUnitsPage() {
  const { token } = useAuth()
  const [units, setUnits] = useState([])
  const [assignments, setAssignments] = useState([])
  const [bills, setBills] = useState([])
  const [payments, setPayments] = useState([])
  const [users, setUsers] = useState([])
  const [form, setForm] = useState(blankUnit)
  const [editingId, setEditingId] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [modalMode, setModalMode] = useState('create')
  const [assignmentForm, setAssignmentForm] = useState(blankAssignment)
  const [assignmentBusy, setAssignmentBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [floor, setFloor] = useState('ALL')
  const [status, setStatus] = useState('ALL')
  const [balance, setBalance] = useState('ALL')
  const [notice, setNotice] = useState({ error: '', message: '' })

  const loadData = useCallback(async () => {
    const [unitData, assignmentData, billData, paymentData, userData] = await Promise.all([
      apiRequest('/api/units', { token }),
      apiRequest('/api/unit-assignments', { token }),
      apiRequest('/api/bills', { token }),
      apiRequest('/api/payments', { token }),
      apiRequest('/api/users', { token }),
    ])
    setUnits(unitData.units || [])
    setAssignments(assignmentData.assignments || [])
    setBills(billData.bills || [])
    setPayments(paymentData.payments || [])
    setUsers(userData.users || [])
  }, [token])

  useEffect(() => {
    let active = true
    Promise.all([
      apiRequest('/api/units', { token }),
      apiRequest('/api/unit-assignments', { token }),
      apiRequest('/api/bills', { token }),
      apiRequest('/api/payments', { token }),
      apiRequest('/api/users', { token }),
    ])
      .then(([unitData, assignmentData, billData, paymentData, userData]) => {
        if (!active) return
        setUnits(unitData.units || [])
        setAssignments(assignmentData.assignments || [])
        setBills(billData.bills || [])
        setPayments(paymentData.payments || [])
        setUsers(userData.users || [])
      })
      .catch((error) => { if (active) setNotice({ error: error.message, message: '' }) })
    return () => { active = false }
  }, [token])

  const floors = useMemo(() => [...new Set(units.map((unit) => unit.floor).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })), [units])

  const rows = useMemo(() => {
    const residentsByUnit = new Map()
    assignments.filter((assignment) => !assignment.endDate).forEach((assignment) => {
      const current = residentsByUnit.get(assignment.unitId) || []
      current.push(assignment.residentName)
      residentsByUnit.set(assignment.unitId, current)
    })
    const latestBillByUnit = new Map()
    bills.forEach((bill) => {
      const current = latestBillByUnit.get(bill.unitId)
      if (!current || String(bill.periodStart) > String(current.periodStart)) latestBillByUnit.set(bill.unitId, bill)
    })
    const latestPaymentByUnit = new Map()
    payments.filter((payment) => payment.reviewStatus === 'APPROVED').forEach((payment) => {
      const current = latestPaymentByUnit.get(payment.unitId)
      const paymentDate = payment.verifiedPaymentDate || payment.submittedAt
      const currentDate = current?.verifiedPaymentDate || current?.submittedAt
      if (!current || String(paymentDate) > String(currentDate)) latestPaymentByUnit.set(payment.unitId, payment)
    })
    return units.map((unit) => {
      const latestBill = latestBillByUnit.get(unit.id)
      return {
        ...unit,
        residents: residentsByUnit.get(unit.id) || [],
        outstandingBalance: Number(latestBill?.remainingBalance || 0),
        lastPayment: latestPaymentByUnit.get(unit.id)?.verifiedPaymentDate || latestPaymentByUnit.get(unit.id)?.submittedAt || null,
      }
    }).sort((a, b) => String(a.unitNumber).localeCompare(String(b.unitNumber), undefined, { numeric: true }))
  }, [assignments, bills, payments, units])

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter((unit) => {
      const matchesSearch = !term || [unit.unitNumber, unit.floor, ...unit.residents].filter(Boolean).join(' ').toLowerCase().includes(term)
      const matchesFloor = floor === 'ALL' || String(unit.floor) === floor
      const matchesStatus = status === 'ALL' || unit.occupancyStatus === status
      const matchesBalance = balance === 'ALL' || (balance === 'OPEN' ? unit.outstandingBalance > 0 : unit.outstandingBalance === 0)
      return matchesSearch && matchesFloor && matchesStatus && matchesBalance
    })
  }, [balance, floor, rows, search, status])

  const occupiedCount = units.filter((unit) => unit.occupancyStatus === 'OCCUPIED').length
  const activeAssignments = useMemo(
    () => assignments.filter((assignment) => assignment.unitId === editingId && !assignment.endDate),
    [assignments, editingId],
  )
  const selectedUnit = useMemo(() => rows.find((unit) => unit.id === editingId) || null, [editingId, rows])
  const residents = useMemo(() => users.filter((user) => user.role === 'RESIDENT' && user.isActive), [users])

  async function runAction(action, message) {
    setNotice({ error: '', message: '' })
    try {
      await action()
      await loadData()
      setNotice({ error: '', message })
      return true
    } catch (error) {
      setNotice({ error: error.message, message: '' })
      return false
    }
  }

  function openCreateForm() {
    setEditingId(null)
    setForm(blankUnit)
    setAssignmentForm(blankAssignment)
    setModalMode('create')
    setFormOpen(true)
  }

  function startEdit(unit) {
    setEditingId(unit.id)
    setForm({ unitNumber: unit.unitNumber, floor: unit.floor, billableAreaSqm: unit.billableAreaSqm ?? '', occupancyStatus: unit.occupancyStatus })
    setAssignmentForm(blankAssignment)
    setModalMode('edit')
    setFormOpen(true)
  }

  function openView(unit) {
    setEditingId(unit.id)
    setForm({ unitNumber: unit.unitNumber, floor: unit.floor, billableAreaSqm: unit.billableAreaSqm ?? '', occupancyStatus: unit.occupancyStatus })
    setModalMode('view')
    setFormOpen(true)
  }

  function closeForm() {
    setEditingId(null)
    setForm(blankUnit)
    setAssignmentForm(blankAssignment)
    setFormOpen(false)
  }

  async function saveUnit(event) {
    event.preventDefault()
    const saved = await runAction(
      () => apiRequest(editingId ? `/api/units/${editingId}` : '/api/units', { method: editingId ? 'PATCH' : 'POST', token, body: form }),
      editingId ? 'Unit updated.' : 'Unit added.',
    )
    if (saved) closeForm()
  }

  async function createAssignment(event) {
    event.preventDefault()
    if (!editingId) return
    setAssignmentBusy(true)
    const created = await runAction(
      () => apiRequest('/api/unit-assignments', { method: 'POST', token, body: { ...assignmentForm, unitId: editingId } }),
      'Resident assigned to this unit.',
    )
    if (created) setAssignmentForm(blankAssignment)
    setAssignmentBusy(false)
  }

  return <DashboardLayout title="Manage units" description="Create and maintain unit records, occupancy, and billing visibility.">
    {notice.error || notice.message ? <p className={`rounded-lg p-3 text-sm ${notice.error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{notice.error || notice.message}</p> : null}
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><h1 className="text-2xl font-black tracking-tight text-[var(--ink)]">Unit management</h1><p className="mt-1 text-sm text-[var(--muted)]">{units.length} units · {occupiedCount} occupied · {units.length - occupiedCount} vacant</p></div>
      <button type="button" onClick={openCreateForm} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:brightness-95"><Plus size={17} /> Add unit</button>
    </div>

    {formOpen && <UnitModal
      assignments={activeAssignments}
      assignmentBusy={assignmentBusy}
      assignmentForm={assignmentForm}
      form={form}
      mode={modalMode}
      residents={residents}
      selectedUnit={selectedUnit}
      onAssignmentChange={(field, value) => setAssignmentForm((current) => ({ ...current, [field]: value }))}
      onClose={closeForm}
      onCreateAssignment={createAssignment}
      onEndAssignment={(assignment) => runAction(() => apiRequest(`/api/unit-assignments/${assignment.id}`, { method: 'DELETE', token }), 'Assignment ended.')}
      onFormChange={(field, value) => setForm((current) => ({ ...current, [field]: value }))}
      onSave={saveUnit}
    />}

    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-sm">
      <div className="grid gap-3 border-b border-[var(--border)] p-4 lg:grid-cols-[minmax(280px,1fr)_180px_200px_180px_auto] lg:items-center">
        <label className="relative min-w-0 flex-1"><Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search unit number or resident..." className="w-full rounded-lg border border-[var(--border)] bg-white py-2.5 pl-10 pr-3 text-sm outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--active-bg)]" /></label>
        <select value={floor} onChange={(event) => setFloor(event.target.value)} className={`${inputClass.replace('mt-1.5 ', '')} min-w-0`}><option value="ALL">Floor: all</option>{floors.map((option) => <option key={option} value={option}>Floor: {option}</option>)}</select>
        <select value={status} onChange={(event) => setStatus(event.target.value)} className={`${inputClass.replace('mt-1.5 ', '')} min-w-0`}><option value="ALL">Occupancy: all</option><option value="OCCUPIED">Occupied</option><option value="VACANT">Vacant</option></select>
        <select value={balance} onChange={(event) => setBalance(event.target.value)} className={`${inputClass.replace('mt-1.5 ', '')} min-w-0`}><option value="ALL">Balance: any</option><option value="OPEN">With balance</option><option value="CLEAR">Clear balance</option></select>
        <p className="whitespace-nowrap text-right text-xs font-bold text-[var(--muted)]">{filteredRows.length} of {units.length} · 10 rows visible</p>
      </div>
      <div className="max-h-[690px] overflow-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="sticky top-0 z-10 bg-[var(--app-bg)] text-[11px] uppercase tracking-[0.08em] text-[var(--muted)] shadow-sm"><tr><th className="px-4 py-3 font-bold">Unit</th><th className="px-4 py-3 font-bold">Resident</th><th className="px-4 py-3 font-bold">Floor / area</th><th className="px-4 py-3 font-bold">Open balance</th><th className="px-4 py-3 font-bold">Occupancy</th><th className="px-4 py-3 font-bold">Last payment</th><th className="px-4 py-3 text-right font-bold">Actions</th></tr></thead><tbody className="divide-y divide-[var(--border)]">
        {filteredRows.map((unit) => <tr key={unit.id} className="transition hover:bg-[var(--app-bg)]"><td className="px-4 py-3.5 font-black text-[var(--primary)]">{unit.unitNumber}</td><td className="px-4 py-3.5 text-[var(--ink)]">{unit.residents.length ? unit.residents.join(', ') : '-'}</td><td className="px-4 py-3.5 text-[var(--muted)]">Floor {unit.floor || '-'} · {unit.billableAreaSqm ? `${unit.billableAreaSqm} sqm` : 'Area not set'}</td><td className={`px-4 py-3.5 font-mono text-xs ${unit.outstandingBalance > 0 ? 'font-bold text-red-600' : 'text-[var(--muted)]'}`}>{money(unit.outstandingBalance)}</td><td className="px-4 py-3.5"><OccupancyBadge status={unit.occupancyStatus} /></td><td className="px-4 py-3.5 text-[var(--muted)]">{date(unit.lastPayment)}</td><td className="px-4 py-3.5"><div className="flex justify-end gap-2"><button type="button" onClick={() => openView(unit)} className={actionClass}>View</button><button type="button" onClick={() => startEdit(unit)} className={actionClass}>Edit</button><button type="button" onClick={() => window.confirm(`Delete unit ${unit.unitNumber}?`) && runAction(() => apiRequest(`/api/units/${unit.id}`, { method: 'DELETE', token }), 'Unit deleted.')} className={`${actionClass} text-red-600`}>Delete</button></div></td></tr>)}
      </tbody></table></div>
      {filteredRows.length === 0 ? <div className="p-4"><EmptyRow message={units.length ? 'No units match the selected filters.' : 'No units have been added yet.'} /></div> : null}
    </section>
  </DashboardLayout>
}

function UnitModal({ assignments, assignmentBusy, assignmentForm, form, mode, residents, selectedUnit, onAssignmentChange, onClose, onCreateAssignment, onEndAssignment, onFormChange, onSave }) {
  const readOnly = mode === 'view'
  const editing = mode === 'edit'
  const title = readOnly ? `Unit ${form.unitNumber}` : editing ? `Edit unit ${form.unitNumber}` : 'Add unit'

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-4" role="presentation" onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="unit-modal-title" className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="unit-modal-title" className="text-xl font-black text-[var(--ink)]">{title}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">{readOnly ? 'Read-only unit, billing, and resident information.' : editing ? 'Update unit details, occupancy, and resident assignments in one place.' : 'Create the unit before assigning a resident.'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close unit modal" className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--app-bg)]"><X size={18} /></button>
        </div>

        {readOnly ? (
          <div className="mt-6 space-y-5">
            <dl className="grid gap-3 sm:grid-cols-2">
              <ReadOnlyField label="Unit number" value={form.unitNumber} />
              <ReadOnlyField label="Occupancy" value={<OccupancyBadge status={form.occupancyStatus} />} />
              <ReadOnlyField label="Floor" value={form.floor || '-'} />
              <ReadOnlyField label="Billable area" value={form.billableAreaSqm ? `${form.billableAreaSqm} sqm` : '-'} />
              <ReadOnlyField label="Open balance" value={money(selectedUnit?.outstandingBalance)} />
              <ReadOnlyField label="Last payment" value={date(selectedUnit?.lastPayment)} />
            </dl>
            <AssignmentSummary assignments={assignments} />
            <div className="flex justify-end"><button type="button" onClick={onClose} className="rounded-lg bg-[var(--primary)] px-5 py-2.5 text-sm font-bold text-white">Close</button></div>
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            <form onSubmit={onSave} className="grid gap-4 sm:grid-cols-2">
              <Field label="Unit number"><input required value={form.unitNumber} onChange={(event) => onFormChange('unitNumber', event.target.value)} className={inputClass} /></Field>
              <Field label="Floor"><input required value={form.floor} onChange={(event) => onFormChange('floor', event.target.value)} className={inputClass} /></Field>
              <Field label="Billable area (sqm)"><input required min="0.01" step="0.01" type="number" value={form.billableAreaSqm} onChange={(event) => onFormChange('billableAreaSqm', event.target.value)} className={inputClass} /></Field>
              <Field label="Occupancy"><select value={form.occupancyStatus} onChange={(event) => onFormChange('occupancyStatus', event.target.value)} className={inputClass}><option value="VACANT">Vacant</option><option value="OCCUPIED">Occupied</option></select></Field>
              <div className="flex justify-end gap-3 sm:col-span-2"><button type="button" onClick={onClose} className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-bold text-[var(--ink)]">Cancel</button><button className="rounded-lg bg-[var(--primary)] px-5 py-2.5 text-sm font-bold text-white">{editing ? 'Save unit changes' : 'Add unit'}</button></div>
            </form>

            {editing && <section className="border-t border-[var(--border)] pt-6">
              <div><h3 className="text-base font-black text-[var(--ink)]">Resident assignments</h3><p className="mt-1 text-sm text-[var(--muted)]">Add or end the active residents assigned to this unit.</p></div>
              <AssignmentSummary assignments={assignments} onEnd={onEndAssignment} />
              <form onSubmit={onCreateAssignment} className="mt-4 grid gap-3 rounded-xl bg-[var(--app-bg)] p-4 sm:grid-cols-2">
                <Field label="Resident"><select required value={assignmentForm.userId} onChange={(event) => onAssignmentChange('userId', event.target.value)} className={inputClass}><option value="">Select resident</option>{residents.map((resident) => <option key={resident.id} value={resident.id}>{resident.fullName}</option>)}</select></Field>
                <Field label="Relationship"><select value={assignmentForm.relationshipType} onChange={(event) => onAssignmentChange('relationshipType', event.target.value)} className={inputClass}><option value="OWNER">Owner</option><option value="TENANT">Tenant</option></select></Field>
                <label className="flex items-center gap-2 text-sm font-bold text-[var(--ink)] sm:col-span-2"><input type="checkbox" checked={assignmentForm.isPrimaryPayer} onChange={(event) => onAssignmentChange('isPrimaryPayer', event.target.checked)} /> Primary payer for this unit</label>
                <div className="sm:col-span-2"><button disabled={assignmentBusy || !assignmentForm.userId} className="rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-bold text-white disabled:bg-slate-300">{assignmentBusy ? 'Assigning...' : 'Add resident assignment'}</button></div>
              </form>
            </section>}
          </div>
        )}
      </section>
    </div>
  )
}

function AssignmentSummary({ assignments, onEnd }) {
  return (
    <section className="mt-5 rounded-xl border border-[var(--border)] bg-white">
      <div className="border-b border-[var(--border)] px-4 py-3 text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Active residents</div>
      {assignments.length ? assignments.map((assignment) => <div key={assignment.id} className="flex flex-col gap-2 border-b border-[var(--border)] px-4 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-bold text-[var(--ink)]">{assignment.residentName}</p><p className="text-xs text-[var(--muted)]">{assignment.relationshipType}{assignment.isPrimaryPayer ? ' · Primary payer' : ''}</p></div>{onEnd && <button type="button" onClick={() => onEnd(assignment)} className="w-fit rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50">End assignment</button>}</div>) : <p className="px-4 py-4 text-sm text-[var(--muted)]">No active residents assigned.</p>}
    </section>
  )
}

function ReadOnlyField({ label, value }) {
  return <div className="rounded-xl bg-[var(--app-bg)] p-4"><dt className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">{label}</dt><dd className="mt-2 text-sm font-semibold text-[var(--ink)]">{value}</dd></div>
}
