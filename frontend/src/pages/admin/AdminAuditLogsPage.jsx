import { useEffect, useMemo, useState } from 'react'
import { Activity, CheckCircle2, ChevronDown, CircleUserRound, FileText, Pencil, Plus, ShieldCheck, Trash2, UserRound, UsersRound, XCircle } from 'lucide-react'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import NoticeToast from '../../components/NoticeToast'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

const entityGroups = [
  { label: 'All activity', options: ['ALL'] },
  { label: 'Records', options: ['USER_ACCOUNT', 'UNIT', 'UNIT_ASSIGNMENT', 'BILLING_PERIOD', 'UNIT_BILL'] },
  { label: 'Payments & insights', options: ['PAYMENT_SUBMISSION', 'PRESCRIPTIVE_RECOMMENDATION'] },
]
const actionGroups = [
  { label: 'General', options: ['ALL', 'CREATE', 'CREATE_MANUAL', 'UPDATE'] },
  { label: 'Records', options: ['DELETE', 'DELETED', 'END', 'GENERATED', 'REOPENED', 'FORWARDED', 'PUBLISHED', 'SOA_EDITED', 'VIEWED', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED', 'SHARED_WITH_RESIDENT'] },
  { label: 'Payments', options: ['SUBMIT', 'APPROVE', 'REJECT'] },
]

const entityLabels = {
  USER_ACCOUNT: 'User Account',
  UNIT: 'Unit',
  UNIT_ASSIGNMENT: 'Unit Assignment',
  PAYMENT_SUBMISSION: 'Payment',
  BILLING_PERIOD: 'Billing Batch',
  UNIT_BILL: 'Unit Bill',
  SOA_TEMPLATE: 'SOA Template',
  PRESCRIPTIVE_RECOMMENDATION: 'Recommended Action',
}

const actionLabels = {
  CREATE: 'Created',
  CREATE_MANUAL: 'Recorded',
  UPDATE: 'Updated',
  DELETE: 'Deleted',// double deleted, but keeping it for consistency with the original code
  DELETED: 'Deleted',
  END: 'Ended',
  SUBMIT: 'Submitted',
  APPROVE: 'Approved',
  REJECT: 'Rejected',
  GENERATED: 'Generated',
  REOPENED: 'Reopened',
  FORWARDED: 'Forwarded',
  PUBLISHED: 'Published',
  SOA_EDITED: 'Edited',
  VIEWED: 'Viewed',
  ACKNOWLEDGED: 'Acknowledged',
  RESOLVED: 'Resolved',
  DISMISSED: 'Dismissed',
  SHARED_WITH_RESIDENT: 'Shared with the Resident',
}

const actionFilterLabels = {
  ...actionLabels,
  DELETE: 'Deleted User Account',
  DELETED: 'Deleted Billing Batch',
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
  const [entityMenuOpen, setEntityMenuOpen] = useState(false)
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
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
      <NoticeToast key={notice.error || notice.message || 'empty'} error={notice.error} message={notice.message} />

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Total entries" value={summary.total} icon={Activity} accent="blue" />
        <StatCard label="Admin actions" value={summary.adminActions} icon={ShieldCheck} accent="green" />
        <StatCard label="Collector actions" value={summary.collectorActions} icon={UsersRound} accent="red" />
        <StatCard label="Resident actions" value={summary.residentActions} icon={UserRound} accent="blue" />
      </div>

      <Panel title="Filter activity" description="Choose a category to find a specific activity.">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="block text-sm font-bold text-slate-700">
            <p>What changed?</p>
            <div className="relative mt-2">
              <button type="button" aria-expanded={entityMenuOpen} onClick={() => { setEntityMenuOpen((current) => !current); setActionMenuOpen(false) }} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-[#b8d9c2] bg-white px-3.5 text-left text-sm font-bold text-[#345744] shadow-sm transition hover:border-[#2f8f5b]">
                <span className="truncate">{entity === 'ALL' ? 'Everything' : labelFor(entity, entityLabels)}</span>
                <ChevronDown size={17} className={`shrink-0 text-[#587064] transition ${entityMenuOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>
              {entityMenuOpen && (
                <div className="absolute inset-x-0 top-[calc(100%+8px)] z-30 max-h-80 overflow-y-auto rounded-xl border border-[#d7eadc] bg-white p-3 shadow-xl">
                  {entityGroups.map((group) => (
                    <div key={group.label} className="not-first:mt-3">
                      <p className="px-2 pb-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-[#668074]">{group.label}</p>
                      <div className="grid gap-1 sm:grid-cols-2">
                        {group.options.map((option) => {
                          const label = option === 'ALL' ? 'Everything' : labelFor(option, entityLabels)
                          return <button key={option} type="button" onClick={() => { setEntity(option); setEntityMenuOpen(false) }} className={`rounded-lg px-2.5 py-2 text-left text-xs font-bold transition ${entity === option ? 'bg-[#2f8f5b] text-white' : 'text-[#466653] hover:bg-[#effaf2] hover:text-[#2f8f5b]'}`}>{label}</button>
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="block text-sm font-bold text-slate-700">
            <p>What happened?</p>
            <div className="relative mt-2">
              <button type="button" aria-expanded={actionMenuOpen} onClick={() => { setActionMenuOpen((current) => !current); setEntityMenuOpen(false) }} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-[#b8d9c2] bg-white px-3.5 text-left text-sm font-bold text-[#345744] shadow-sm transition hover:border-[#2f8f5b]">
                <span className="truncate">{action === 'ALL' ? 'Everything' : labelFor(action, actionFilterLabels)}</span>
                <ChevronDown size={17} className={`shrink-0 text-[#587064] transition ${actionMenuOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>
              {actionMenuOpen && (
                <div className="absolute inset-x-0 top-[calc(100%+8px)] z-30 max-h-80 overflow-y-auto rounded-xl border border-[#d7eadc] bg-white p-3 shadow-xl">
                  {actionGroups.map((group) => (
                    <div key={group.label} className="not-first:mt-3">
                      <p className="px-2 pb-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-[#668074]">{group.label}</p>
                      <div className="grid gap-1 sm:grid-cols-2">
                        {group.options.map((option) => {
                          const label = option === 'ALL' ? 'Everything' : labelFor(option, actionFilterLabels)
                          return <button key={option} type="button" onClick={() => { setAction(option); setActionMenuOpen(false) }} className={`rounded-lg px-2.5 py-2 text-left text-xs font-bold transition ${action === option ? 'bg-[#2f8f5b] text-white' : 'text-[#466653] hover:bg-[#effaf2] hover:text-[#2f8f5b]'}`}>{label}</button>
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="Activity feed" description="Each row explains one action in plain language.">
        <div className="divide-y divide-slate-300">
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
                      <span className="text-xs text-slate-500">{String(log.actorRole || 'deleted').toLowerCase()}</span>
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

function StatCard({ accent, icon: Icon, label, value }) {
  return (
    <div className={`collector-metric collector-metric-${accent} rounded-2xl border border-[var(--border)] p-5 shadow-sm`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-[var(--muted)]">{label}</p>
          <p className="mt-3 text-3xl font-black text-[var(--ink)]">{value}</p>
        </div>
        <span className="grid size-11 place-items-center rounded-xl"><Icon size={21} /></span>
      </div>
    </div>
  )
}
