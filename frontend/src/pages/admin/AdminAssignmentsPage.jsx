import { useCallback, useEffect, useState } from 'react'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

const blankAssignment = { unitId: '', userId: '', relationshipType: 'OWNER', isPrimaryPayer: false }
const inputClass = 'mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal'
const actionClass = 'rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50'

function Field({ label, children }) {
  return <label className="block text-xs font-bold text-slate-600">{label}{children}</label>
}

export default function AdminAssignmentsPage() {
  const { token } = useAuth()
  const [assignments, setAssignments] = useState([])
  const [units, setUnits] = useState([])
  const [users, setUsers] = useState([])
  const [form, setForm] = useState(blankAssignment)
  const [notice, setNotice] = useState({ error: '', message: '' })

  const loadData = useCallback(async () => {
    const [assignmentData, unitData, userData] = await Promise.all([
      apiRequest('/api/unit-assignments', { token }),
      apiRequest('/api/units', { token }),
      apiRequest('/api/users', { token }),
    ])
    setAssignments(assignmentData.assignments)
    setUnits(unitData.units)
    setUsers(userData.users)
  }, [token])

  useEffect(() => {
    let active = true
    Promise.all([
      apiRequest('/api/unit-assignments', { token }),
      apiRequest('/api/units', { token }),
      apiRequest('/api/users', { token }),
    ]).then(([assignmentData, unitData, userData]) => {
      if (!active) return
      setAssignments(assignmentData.assignments)
      setUnits(unitData.units)
      setUsers(userData.users)
    }).catch((error) => {
      if (active) setNotice({ error: error.message, message: '' })
    })
    return () => { active = false }
  }, [token])

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

  async function createAssignment(event) {
    event.preventDefault()
    const created = await runAction(() => apiRequest('/api/unit-assignments', { method: 'POST', token, body: form }), 'Assignment created.')
    if (created) setForm(blankAssignment)
  }

  return (
    <DashboardLayout title="Unit assignments" description="Assign active Residents to units as owners or tenants.">
      {(notice.error || notice.message) && <p className={`rounded-lg p-3 text-sm ${notice.error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{notice.error || notice.message}</p>}
      <Panel title="Assignments" description="Connect an active Resident account to a unit.">
        <form onSubmit={createAssignment} className="grid gap-3 rounded-xl bg-slate-50 p-4 md:grid-cols-5">
          <Field label="Unit"><select required value={form.unitId} onChange={(event) => setForm({ ...form, unitId: event.target.value })} className={inputClass}><option value="">Select unit</option>{units.map((unit) => <option key={unit.id} value={unit.id}>Unit {unit.unitNumber}</option>)}</select></Field>
          <Field label="Resident"><select required value={form.userId} onChange={(event) => setForm({ ...form, userId: event.target.value })} className={inputClass}><option value="">Select resident</option>{users.filter((user) => user.role === 'RESIDENT' && user.isActive).map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}</select></Field>
          <Field label="Relationship"><select value={form.relationshipType} onChange={(event) => setForm({ ...form, relationshipType: event.target.value })} className={inputClass}><option value="OWNER">Owner</option><option value="TENANT">Tenant</option></select></Field>
          <label className="flex items-end gap-2 pb-2.5 text-sm font-bold text-slate-600"><input type="checkbox" checked={form.isPrimaryPayer} onChange={(event) => setForm({ ...form, isPrimaryPayer: event.target.checked })} /> Primary payer</label>
          <button className="self-end rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white">Assign</button>
        </form>
        <div className="mt-5 space-y-3">
          {assignments.map((assignment) => (
            <article key={assignment.id} className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center">
              <div><p className="font-bold">{assignment.residentName} to Unit {assignment.unitNumber}</p><p className="text-xs text-slate-500">{assignment.relationshipType}{assignment.isPrimaryPayer ? ' - Primary payer' : ''} - {assignment.endDate ? `Ended ${assignment.endDate}` : 'Active'}</p></div>
              {!assignment.endDate && <button className={`${actionClass} w-fit`} onClick={() => runAction(() => apiRequest(`/api/unit-assignments/${assignment.id}`, { method: 'DELETE', token }), 'Assignment ended.')}>End assignment</button>}
            </article>
          ))}
        </div>
        {assignments.length === 0 && <EmptyRow message="No assignments found." />}
      </Panel>
    </DashboardLayout>
  )
}
