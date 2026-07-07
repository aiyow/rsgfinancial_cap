import { useEffect, useState } from 'react'
import DashboardLayout, { EmptyRow, Panel } from './DashboardLayout'
import useAuth from '../hooks/useAuth'
import { apiRequest } from '../services/api'

export default function ReadOnlyRecords({ title, description, residentView = false }) {
  const { token } = useAuth()
  const [units, setUnits] = useState([])
  const [assignments, setAssignments] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([
      apiRequest('/api/units', { token }),
      apiRequest('/api/unit-assignments', { token }),
    ]).then(([unitData, assignmentData]) => {
      if (!active) return
      setUnits(unitData.units)
      setAssignments(assignmentData.assignments)
    }).catch((requestError) => {
      if (active) setError(requestError.message)
    })
    return () => { active = false }
  }, [token])

  return (
    <DashboardLayout title={title} description={description}>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <Panel id="section-1" title={residentView ? 'My units' : 'Units'} description={residentView ? 'Only units currently assigned to your account are shown.' : 'Read-only condominium unit directory.'}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {units.map((unit) => <article key={unit.id} className="rounded-xl border border-slate-200 p-4"><div className="flex justify-between gap-3"><div><p className="font-black">Unit {unit.unitNumber}</p><p className="text-xs text-slate-500">Floor {unit.floor}</p></div><span className="text-xs font-bold text-slate-500">{unit.occupancyStatus}</span></div><p className="mt-4 text-sm">Billable area: <strong>{unit.billableAreaSqm ?? 'Not set'} sqm</strong></p></article>)}
        </div>
        {units.length === 0 && <EmptyRow message="No units available." />}
      </Panel>

      <Panel id="section-2" title={residentView ? 'My assignments' : 'Assignments'} description="Owner and tenant relationships for the available units.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-left text-sm"><thead className="text-xs uppercase text-slate-400"><tr><th className="pb-3">Resident</th><th>Unit</th><th>Relationship</th><th>Payer</th><th>Status</th></tr></thead><tbody className="divide-y divide-slate-100">
            {assignments.map((assignment) => <tr key={assignment.id}><td className="py-3 font-bold">{assignment.residentName}</td><td>{assignment.unitNumber}</td><td>{assignment.relationshipType}</td><td>{assignment.isPrimaryPayer ? 'Primary' : 'No'}</td><td>{assignment.endDate ? 'Ended' : 'Active'}</td></tr>)}
          </tbody></table>
          {assignments.length === 0 && <EmptyRow message="No assignments available." />}
        </div>
      </Panel>
    </DashboardLayout>
  )
}
