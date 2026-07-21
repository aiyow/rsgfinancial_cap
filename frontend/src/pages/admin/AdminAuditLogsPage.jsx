import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CircleUserRound, FileText, Pencil, Plus, Trash2, XCircle } from 'lucide-react'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

const entityOptions = ['ALL', 'USER_ACCOUNT', 'UNIT', 'UNIT_ASSIGNMENT', 'PAYMENT_SUBMISSION', 'BILLING_PERIOD', 'UNIT_BILL', 'PRESCRIPTIVE_RECOMMENDATION']
const actionOptions = ['ALL', 'CREATE', 'CREATE_MANUAL', 'UPDATE', 'DELETE', 'DELETED', 'END', 'SUBMIT', 'APPROVE', 'REJECT', 'GENERATED', 'REOPENED', 'FORWARDED', 'PUBLISHED', 'SOA_EDITED', 'VIEWED', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED', 'SHARED_WITH_RESIDENT']

const entityLabels = {
  USER_ACCOUNT: 'user account',
  UNIT: 'unit',
  UNIT_ASSIGNMENT: 'unit assignment',
  PAYMENT_SUBMISSION: 'payment',
  BILLING_PERIOD: 'billing batch',
  UNIT_BILL: 'unit bill',
  SOA_TEMPLATE: 'SOA template',
  PRESCRIPTIVE_RECOMMENDATION: 'recommended action',
}

const actionLabels = {
  CREATE: 'created',
  CREATE_MANUAL: 'recorded',
  UPDATE: 'updated',
  DELETE: 'deleted',
  DELETED: 'deleted',
  END: 'ended',
  SUBMIT: 'submitted',
  APPROVE: 'approved',
  REJECT: 'rejected',
  GENERATED: 'generated',
  REOPENED: 'reopened',
  FORWARDED: 'forwarded',
  PUBLISHED: 'published',
  SOA_EDITED: 'edited',
  VIEWED: 'viewed',
  ACKNOWLEDGED: 'acknowledged',
  RESOLVED: 'resolved',
  DISMISSED: 'dismissed',
  SHARED_WITH_RESIDENT: 'shared with the Resident',
}

const actionIcons = {
  CREATE: Plus,
  CREATE_MANUAL: Plus,
  UPDATE: Pencil,
  DELETE: Trash2,
  END: XCircle,
  SUBMIT: FileText,
  APPROVE: CheckCircle2,
  REJECT: XCircle,
  GENERATED: FileText,
  REOPENED: Pencil,
  FORWARDED: FileText,
  PUBLISHED: CheckCircle2,
  SOA_EDITED: Pencil,
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : 'Unknown time'
}

function labelFor(value, labels) {
  return labels[value] || value.toLowerCase().replaceAll('_', ' ')
}

function describeLog(log) {
  const action = actionLabels[log.action] || log.action.toLowerCase().replaceAll('_', ' ')
  const entity = entityLabels[log.entityName] || 'record'
  return `${action} ${entity}`
}

function initials(name) {
  return String(name || '?')
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
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
    <DashboardLayout title="Audit logs" description="A simple history of important actions in the system.">
      {(notice.error || notice.message) && <p className={`rounded-lg p-3 text-sm ${notice.error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{notice.error || notice.message}</p>}

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Total entries" value={summary.total} />
        <StatCard label="Admin actions" value={summary.adminActions} />
        <StatCard label="Collector actions" value={summary.collectorActions} />
        <StatCard label="Resident actions" value={summary.residentActions} />
      </div>

      <Panel title="Filter activity" description="Choose a category to find a specific activity.">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-bold text-slate-700">
            What changed?
            <select value={entity} onChange={(event) => setEntity(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              {entityOptions.map((option) => <option key={option} value={option}>{option === 'ALL' ? 'Everything' : labelFor(option, entityLabels)}</option>)}
            </select>
          </label>
          <label className="block text-sm font-bold text-slate-700">
            What happened?
            <select value={action} onChange={(event) => setAction(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              {actionOptions.map((option) => <option key={option} value={option}>{option === 'ALL' ? 'Everything' : labelFor(option, actionLabels)}</option>)}
            </select>
          </label>
        </div>
      </Panel>

      <Panel title="Activity feed" description="Each row explains one action in plain language.">
        <div className="divide-y divide-slate-100">
          {logs.map((log) => {
            const ActionIcon = actionIcons[log.action] || CircleUserRound

            return (
              <article key={`${log.source}-${log.id}`} title={log.remarks || undefined} className="flex flex-col gap-3 px-1 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-700" aria-hidden="true">{initials(log.actorName)}</span>
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-700">
                      <span className="font-bold text-slate-950">{log.actorName}</span>
                      <span className="mx-1.5">{describeLog(log)}.</span>
                      <span className="text-xs text-slate-500">{log.actorRole ? log.actorRole.toLowerCase() : 'deleted account'}</span>
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 pl-12 text-xs text-slate-500 sm:pl-0">
                  <ActionIcon size={15} className="text-indigo-600" aria-hidden="true" />
                  <time dateTime={log.createdAt}>{formatDate(log.createdAt)}</time>
                </div>
              </article>
            )
          })}
        </div>
        {logs.length === 0 && <EmptyRow message="No activity matches the selected filters." />}
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
