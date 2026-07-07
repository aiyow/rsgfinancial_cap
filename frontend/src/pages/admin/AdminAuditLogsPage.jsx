import { useEffect, useMemo, useState } from 'react'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

const entityOptions = ['ALL', 'USER_ACCOUNT', 'UNIT', 'UNIT_ASSIGNMENT', 'PAYMENT_SUBMISSION', 'BILLING_PERIOD']
const actionOptions = ['ALL', 'CREATE', 'UPDATE', 'DELETE', 'END', 'SUBMIT', 'APPROVE', 'REJECT', 'GENERATED', 'REOPENED', 'FORWARDED', 'PUBLISHED', 'SOA_EDITED']

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : '—'
}

function JsonBlock({ value }) {
  const hasContent = value && typeof value === 'object' && Object.keys(value).length > 0
  return (
    <pre className="max-h-48 overflow-auto rounded-xl bg-slate-950 p-3 text-xs leading-6 text-slate-100">
      {hasContent ? JSON.stringify(value, null, 2) : '{}'}
    </pre>
  )
}

export default function AdminAuditLogsPage() {
  const { token } = useAuth()
  const [entity, setEntity] = useState('ALL')
  const [action, setAction] = useState('ALL')
  const [logs, setLogs] = useState([])
  const [notice, setNotice] = useState({ error: '', message: '' })

  useEffect(() => {
    let active = true
    const params = new URLSearchParams()
    if (entity !== 'ALL') params.set('entity', entity)
    if (action !== 'ALL') params.set('action', action)
    const query = params.toString() ? `?${params.toString()}` : ''

    apiRequest(`/api/audit-logs${query}`, { token })
      .then((data) => { if (active) setLogs(data.logs) })
      .catch((error) => { if (active) setNotice({ error: error.message, message: '' }) })

    return () => { active = false }
  }, [action, entity, token])

  const summary = useMemo(() => ({
    total: logs.length,
    adminActions: logs.filter((log) => log.actorRole === 'ADMIN').length,
    collectorActions: logs.filter((log) => log.actorRole === 'COLLECTOR').length,
    residentActions: logs.filter((log) => log.actorRole === 'RESIDENT').length,
  }), [logs])

  return (
    <DashboardLayout title="Audit logs" description="Review who changed what across accounts, units, assignments, payments, and billing workflow events.">
      {(notice.error || notice.message) && <p className={`rounded-lg p-3 text-sm ${notice.error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{notice.error || notice.message}</p>}

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Loaded logs" value={summary.total} />
        <StatCard label="Admin actions" value={summary.adminActions} />
        <StatCard label="Collector actions" value={summary.collectorActions} />
        <StatCard label="Resident actions" value={summary.residentActions} />
      </div>

      <Panel title="Filter audit history" description="Use the filters below to narrow the activity feed.">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-bold text-slate-700">
            Entity
            <select value={entity} onChange={(event) => setEntity(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              {entityOptions.map((option) => <option key={option} value={option}>{option === 'ALL' ? 'All entities' : option}</option>)}
            </select>
          </label>
          <label className="block text-sm font-bold text-slate-700">
            Action
            <select value={action} onChange={(event) => setAction(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              {actionOptions.map((option) => <option key={option} value={option}>{option === 'ALL' ? 'All actions' : option}</option>)}
            </select>
          </label>
        </div>
      </Panel>

      <Panel title="Activity feed">
        <div className="space-y-4">
          {logs.map((log) => (
            <article key={`${log.source}-${log.id}`} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{log.source}</span>
                    <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">{log.entityName}</span>
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">{log.action}</span>
                  </div>
                  <h2 className="mt-3 text-lg font-black text-slate-950">{log.actorName} ({log.actorRole})</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Entity ID: {log.entityId ?? '—'} | {formatDate(log.createdAt)}
                  </p>
                  {log.remarks && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{log.remarks}</p>}
                </div>
              </div>

              <div className="mt-5 grid gap-4 xl:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Before</p>
                  <JsonBlock value={log.oldValues} />
                </div>
                <div>
                  <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-400">After</p>
                  <JsonBlock value={log.newValues} />
                </div>
              </div>
            </article>
          ))}
        </div>
        {logs.length === 0 && <EmptyRow message="No audit log entries match the selected filters." />}
      </Panel>
    </DashboardLayout>
  )
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-black text-slate-950">{value}</p>
    </div>
  )
}
