import { useEffect, useRef, useState } from 'react'
import { Activity, ClipboardList, LoaderCircle, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Users } from 'lucide-react'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'
import { actionLabels, auditChangeSummary, auditLabel, auditSummary, auditTime, entityLabels, roleLabels } from '../../utils/auditLogPresentation'

const inputClass = 'min-h-11 w-full min-w-0 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm text-slate-700 focus-visible:outline-2 focus-visible:outline-emerald-600'
const buttonClass = 'min-h-11 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40'
const initialFilters = { q: '', entity: '', action: '', actorRole: '', from: '', to: '' }

export default function AdminAuditLogsPage() {
  const { token } = useAuth()
  const [filters, setFilters] = useState(initialFilters)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const feedRef = useRef(null)
  const [feedHeight, setFeedHeight] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState({ logs: [], summary: {}, pagination: { total: 0, page: 1, pageCount: 1 }, filters: { entities: [], actions: [] } })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const invalidDates = filters.from && filters.to && filters.from > filters.to
  useEffect(() => {
    if (invalidDates) return undefined
    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      setLoading(true); setError('')
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
        for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
        const data = await apiRequest(`/api/audit-logs?${params}`, { token, signal: controller.signal })
        if (!controller.signal.aborted) setResult(data)
      } catch (requestError) { if (!controller.signal.aborted) setError(requestError.message) }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }, 200)
    return () => { window.clearTimeout(timeout); controller.abort() }
  }, [token, filters, page, pageSize, revision, invalidDates])
  function update(field, value) { setFilters(current => ({ ...current, [field]: value })); setPage(1); setFeedHeight(0) }
  function changePage(nextPage) {
    const rows = [...(feedRef.current?.querySelectorAll('.audit-entry') || [])]
    const height = rows.reduce((sum, row) => sum + row.getBoundingClientRect().height, 0) + Math.max(0, rows.length - 1) * 4
    setFeedHeight(current => Math.max(current, height)); setPage(nextPage)
  }
  const activeFilterCount = ['entity', 'action', 'actorRole', 'from', 'to'].filter(key => filters[key]).length
  const summary = result.summary || {}, pagination = result.pagination
  const entities = [...new Set([...(result.filters?.entities || []), filters.entity])].filter(Boolean)
  const actions = [...new Set([...(result.filters?.actions || []), filters.action].map(action => action === 'DELETED' ? 'DELETE' : action))].filter(Boolean)
  return <DashboardLayout title="Activity log" className="audit-shell" description="Saved user changes with the affected record, action, and time."><div className="space-y-4">
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4" aria-label="Activity totals for selected filters">
      <AuditStatCard label="User changes" value={summary.total ?? 0} icon={Activity} accent="blue" />
      <AuditStatCard label="Admin" value={summary.admin ?? 0} icon={ShieldCheck} accent="yellow" />
      <AuditStatCard label="Billing Associate" value={summary.collector ?? 0} icon={ClipboardList} accent="green" />
      <AuditStatCard label="Resident" value={summary.resident ?? 0} icon={Users} accent="red" />
    </div>
    <section aria-label="Activity controls" className="rounded-xl border border-emerald-100 bg-white p-3">
      <div className="flex flex-wrap gap-2">
        <label className="relative min-w-0 flex-1 basis-52"><span className="sr-only">Search activity</span><Search size={16} className="pointer-events-none absolute left-3 top-3.5 text-slate-400" aria-hidden="true" /><input aria-label="Search activity" type="search" value={filters.q} onChange={event => update('q', event.target.value)} placeholder="Search name, batch, unit or REF" className={`${inputClass} pl-9`} /></label>
        <button type="button" aria-expanded={filtersOpen} aria-controls="audit-filters" onClick={() => setFiltersOpen(open => !open)} className={`${buttonClass} inline-flex items-center gap-2`}><SlidersHorizontal size={15} aria-hidden="true" />{filtersOpen ? 'Hide filters' : 'Show filters'}{activeFilterCount > 0 && <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px]">{activeFilterCount}</span>}</button>
        <button type="button" onClick={() => setRevision(value => value + 1)} aria-label="Refresh activity" className={buttonClass}><RefreshCw size={16} aria-hidden="true" /></button>
      </div>
      {filtersOpen && <div id="audit-filters" className="mt-3 grid gap-3 border-t border-emerald-100 pt-3 sm:grid-cols-2 xl:grid-cols-3">
        <Filter label="What changed?" value={filters.entity} onChange={value => update('entity', value)} options={entities} labels={entityLabels} />
        <Filter label="What happened?" value={filters.action} onChange={value => update('action', value)} options={actions} labels={actionLabels} />
        <Filter label="Who made the change?" value={filters.actorRole} onChange={value => update('actorRole', value)} options={['ADMIN', 'COLLECTOR', 'RESIDENT']} labels={roleLabels} />
        <label className="text-xs font-bold text-slate-600">From date<input aria-label="From date" type="date" value={filters.from} onChange={event => update('from', event.target.value)} className={`${inputClass} mt-1.5`} /></label>
        <label className="text-xs font-bold text-slate-600">To date<input aria-label="To date" type="date" min={filters.from || undefined} value={filters.to} onChange={event => update('to', event.target.value)} className={`${inputClass} mt-1.5`} /></label>
        <div className="flex items-end"><button type="button" onClick={() => { setFilters(initialFilters); setPage(1); setFeedHeight(0) }} className={buttonClass}>Clear filters</button></div>
      </div>}
      {invalidDates && <p role="alert" className="mt-3 text-sm text-rose-700">To date must be on or after From date.</p>}
    </section>
    <Panel className="audit-feed-panel" title="Activity feed" description="Each entry shows who made the change, what happened, and the affected record.">
      {error && <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-800"><span>{error}</span><button type="button" onClick={() => setRevision(value => value + 1)} className={buttonClass}>Try again</button></div>}
      <div ref={feedRef} aria-busy={loading} className="relative" style={feedHeight ? { minHeight: feedHeight } : undefined}>
        {loading && !result.logs.length ? <p role="status" className="flex items-center gap-2 p-4 text-sm text-slate-500"><LoaderCircle size={18} className="animate-spin" />Loading activity…</p> : <div className="space-y-1">{!error && result.logs.map(log => <AuditEntry key={log.id} log={log} />)}</div>}
        {loading && result.logs.length > 0 && <div role="status" aria-label="Loading activity page" className="absolute inset-0 z-10 flex items-start justify-center rounded-lg bg-white/75 pt-4"><LoaderCircle size={18} className="animate-spin text-emerald-700" aria-hidden="true" /></div>}
      </div>
      {!loading && !error && result.logs.length === 0 && <EmptyRow message="No saved changes match these filters." />}
      <div className="audit-pagination mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-emerald-100 pt-3 text-xs text-slate-500">
        <p>{pagination.total ? `Showing ${(pagination.page - 1) * pageSize + 1}–${Math.min(pagination.page * pageSize, pagination.total)} of ${pagination.total} entries` : '0 entries'}</p>
        <label className="ml-auto whitespace-nowrap">Per page <select aria-label="Activity entries per page" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); setFeedHeight(0) }} className="ml-1 min-h-11 rounded-lg border border-emerald-200 px-2">{[10, 25, 50].map(size => <option key={size}>{size}</option>)}</select></label>
        <nav aria-label="Activity pages" className="flex w-full items-center justify-between gap-1 sm:w-auto sm:gap-2">
          <button type="button" aria-label="First page" disabled={loading || Boolean(error) || pagination.page <= 1} onClick={() => changePage(1)} className={buttonClass}>First</button>
          <button type="button" disabled={loading || Boolean(error) || pagination.page <= 1} onClick={() => changePage(pagination.page - 1)} className={buttonClass}>Previous</button>
          <span className="whitespace-nowrap">Page {pagination.page} of {pagination.pageCount}</span>
          <button type="button" disabled={loading || Boolean(error) || pagination.page >= pagination.pageCount} onClick={() => changePage(pagination.page + 1)} className={buttonClass}>Next</button>
          <button type="button" aria-label="Last page" disabled={loading || Boolean(error) || pagination.page >= pagination.pageCount} onClick={() => changePage(pagination.pageCount)} className={buttonClass}>Last</button>
        </nav>
      </div>
    </Panel>
  </div></DashboardLayout>
}
function AuditStatCard({ label, value, icon: Icon, accent }) {
  return <div className={`collector-metric collector-metric-${accent} min-w-0 rounded-xl border border-[var(--border)] p-3 shadow-sm sm:p-3.5`}>
    <div className="flex items-center justify-between gap-2 sm:gap-3">
      <div className="min-w-0">
        <p className="break-words text-[11px] font-bold text-[var(--muted)] sm:text-xs">{label}</p>
        <p className="mt-1 text-2xl font-black tabular-nums text-[var(--ink)]">{value}</p>
      </div>
      <span className="grid size-9 shrink-0 place-items-center rounded-xl sm:size-11"><Icon size={21} aria-hidden="true" /></span>
    </div>
  </div>
}
function Filter({ label, value, onChange, options, labels }) {
  return <label className="text-xs font-bold text-slate-600">{label}<select aria-label={label} value={value} onChange={event => onChange(event.target.value)} className={`${inputClass} mt-1.5`}><option value="">Everything</option>{options.map(option => <option key={option} value={option}>{auditLabel(option, labels)}</option>)}</select></label>
}
function AuditEntry({ log }) {
  const changeSummary = auditChangeSummary(log)
  return <article className="audit-entry flex min-h-16 min-w-0 items-center gap-2.5 overflow-hidden rounded-lg border border-emerald-100 bg-white px-3 py-2.5">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-700"><Activity size={14} aria-hidden="true" /></span>
      <span className="min-w-0 flex-1"><span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"><span className="text-xs font-bold text-slate-950">{log.actorName}</span><span className="text-[10px] text-slate-500">{roleLabels[log.actorRole] || 'User'}</span><time dateTime={log.createdAt} className="ml-auto hidden text-[10px] text-slate-500 md:block">{auditTime(log.createdAt)}</time></span><span className="mt-0.5 block break-words text-xs leading-5 text-slate-700">{auditSummary(log)}</span>{changeSummary && <span className="mt-0.5 block break-words text-[11px] leading-5 text-slate-500">{changeSummary}</span>}<time dateTime={log.createdAt} className="mt-0.5 block text-[10px] text-slate-500 md:hidden">{auditTime(log.createdAt)}</time></span>
  </article>
}
