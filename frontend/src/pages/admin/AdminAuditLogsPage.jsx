import { useEffect, useRef, useState } from 'react'
import { Activity, ChevronDown, LoaderCircle, RefreshCw, Search, SlidersHorizontal } from 'lucide-react'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'
import { actionLabels, auditChanges, auditLabel, auditSummary, auditTargetLabel, auditTime, auditValue, entityLabels, roleLabels } from '../../utils/auditLogPresentation'

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
    const rows = [...(feedRef.current?.querySelectorAll('.audit-entry-toggle') || [])]
    const height = rows.reduce((sum, row) => sum + row.getBoundingClientRect().height + 2, 0) + Math.max(0, rows.length - 1) * 4
    setFeedHeight(current => Math.max(current, height)); setPage(nextPage)
  }
  const activeFilterCount = ['entity', 'action', 'actorRole', 'from', 'to'].filter(key => filters[key]).length
  const summary = result.summary || {}, pagination = result.pagination
  const entities = [...new Set([...(result.filters?.entities || []), filters.entity])].filter(Boolean)
  const actions = [...new Set([...(result.filters?.actions || []), filters.action].map(action => action === 'DELETED' ? 'DELETE' : action))].filter(Boolean)
  return <DashboardLayout title="Activity log" className="audit-shell" description="Changes made by users. Expand an entry to see exactly what changed."><div className="space-y-4">
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Activity totals for selected filters">
      {Object.entries({ total: 'User changes', admin: 'Admin', collector: 'Billing Associate', resident: 'Resident' }).map(([key, label]) => <div key={key} className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-emerald-100 bg-white px-3 py-2.5"><p className="text-[11px] font-semibold text-slate-500">{label}</p><p className="text-xl font-black tabular-nums text-slate-950">{summary[key] ?? 0}</p></div>)}
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
    <Panel className="audit-feed-panel" title="Activity feed" description="Select an entry to see record details, before and after values, and affected units.">
      {error && <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-800"><span>{error}</span><button type="button" onClick={() => setRevision(value => value + 1)} className={buttonClass}>Try again</button></div>}
      <div ref={feedRef} aria-busy={loading} className="relative" style={feedHeight ? { minHeight: feedHeight } : undefined}>
        {loading && !result.logs.length ? <p role="status" className="flex items-center gap-2 p-4 text-sm text-slate-500"><LoaderCircle size={18} className="animate-spin" />Loading activity…</p> : <div className="space-y-1">{!error && result.logs.map(log => <AuditEntry key={`${log.id}-${revision}`} log={log} token={token} />)}</div>}
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
function Filter({ label, value, onChange, options, labels }) {
  return <label className="text-xs font-bold text-slate-600">{label}<select aria-label={label} value={value} onChange={event => onChange(event.target.value)} className={`${inputClass} mt-1.5`}><option value="">Everything</option>{options.map(option => <option key={option} value={option}>{auditLabel(option, labels)}</option>)}</select></label>
}
function AuditEntry({ log, token }) {
  const [open, setOpen] = useState(false)
  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestRef = useRef(null)
  useEffect(() => () => requestRef.current?.abort(), [])
  async function load() {
    requestRef.current?.abort()
    const controller = new AbortController(); requestRef.current = controller
    setLoading(true); setError('')
    try { const data = await apiRequest(`/api/audit-logs/${log.id}`, { token, signal: controller.signal }); if (!controller.signal.aborted) setDetails(data.log) }
    catch (requestError) { if (!controller.signal.aborted) setError(requestError.message) }
    finally { if (!controller.signal.aborted) setLoading(false) }
  }
  function toggle() { setOpen(!open); if (!open && !details && !loading) void load() }
  return <article className="min-w-0 overflow-hidden rounded-lg border border-emerald-100 bg-white">
    <button type="button" aria-expanded={open} aria-controls={`audit-details-${log.id}`} onClick={toggle} className="audit-entry-toggle flex min-h-16 w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-emerald-50/60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-emerald-600">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-700"><Activity size={14} aria-hidden="true" /></span>
      <span className="min-w-0 flex-1"><span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"><span className="text-xs font-bold text-slate-950">{log.actorName}</span><span className="text-[10px] text-slate-500">{roleLabels[log.actorRole] || 'User'}</span><time dateTime={log.createdAt} className="ml-auto hidden text-[10px] text-slate-500 md:block">{auditTime(log.createdAt)}</time></span><span className="mt-0.5 block break-words text-xs leading-5 text-slate-700">{auditSummary(log)}</span><time dateTime={log.createdAt} className="mt-0.5 block text-[10px] text-slate-500 md:hidden">{auditTime(log.createdAt)}</time></span>
      <ChevronDown size={16} aria-hidden="true" className={`shrink-0 text-emerald-700 transition ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div id={`audit-details-${log.id}`} className="min-w-0 border-t border-emerald-100 bg-slate-50/60 p-3 sm:p-4">
      {loading && <p role="status" className="text-sm text-slate-500">Loading details…</p>}
      {error && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-rose-700"><p>{error}</p><button type="button" onClick={load} className={buttonClass}>Retry details</button></div>}
      {details && <AuditDetails log={details} />}
    </div>}
  </article>
}
function AuditDetails({ log }) {
  const changes = auditChanges(log.oldValues, log.newValues)
  const target = log.context?.target || {}
  const credentialEvent = /PASSWORD/.test(log.action)
  return <div className="min-w-0 space-y-4">
    <dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
      <Fact label="Record" value={auditTargetLabel(log)} /><Fact label="Activity entry" value={`#${log.id}`} />
      {Object.entries(target).filter(([key]) => !['entityName', 'entityId', 'label'].includes(key)).map(([key, value]) => <Fact key={key} label={auditLabel(key)} value={auditValue(value, key)} />)}
      {Object.entries(log.context?.counts || {}).map(([key, value]) => <Fact key={key} label={auditLabel(key)} value={auditValue(value, key)} />)}
    </dl>
    {log.remarks && <div className="rounded-lg border border-emerald-100 bg-white p-3 text-sm"><p className="font-bold text-slate-800">Reason / notes</p><p className="mt-1 whitespace-pre-wrap break-words leading-6 text-slate-600">{log.remarks}</p></div>}
    {credentialEvent && <p className="rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">Password changed. Credential values are never recorded.</p>}
    {changes.length ? <div className="overflow-x-auto rounded-lg border border-emerald-100 bg-white"><table className="w-full min-w-[420px] text-left text-xs"><caption className="sr-only">Changed fields</caption><thead className="bg-emerald-50 text-slate-600"><tr><th className="px-3 py-2">Field</th><th className="px-3 py-2">Before</th><th className="px-3 py-2">After</th></tr></thead><tbody className="divide-y divide-emerald-50">{changes.map(change => <tr key={change.key}><th scope="row" className="max-w-44 break-words px-3 py-2 font-semibold text-slate-700">{change.label}</th><td className="max-w-64 whitespace-pre-wrap break-words px-3 py-2 align-top text-slate-500">{change.before}</td><td className="max-w-64 whitespace-pre-wrap break-words px-3 py-2 align-top font-medium text-emerald-900">{change.after}</td></tr>)}</tbody></table></div> : !credentialEvent && <p className="text-xs text-slate-500">Field-level changes were not recorded for this entry.</p>}
    <AffectedRecords records={log.context?.affectedRecords || []} />
    {!log.context?.version && <p className="text-xs leading-5 text-slate-500">Historical entry: details that were not captured at the time are shown as Not recorded.</p>}
  </div>
}
function Fact({ label, value }) { return <div className="min-w-0"><dt className="text-slate-500">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words font-semibold leading-5 text-slate-800">{value}</dd></div> }
function AffectedRecords({ records }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  if (!records.length) return null
  const filtered = records.filter(row => [row.unitNumber, row.fullName, row.entityId, row.periodStart, row.periodEnd, row.periodId].join(' ').toLowerCase().includes(search.toLowerCase()))
  const pageCount = Math.max(1, Math.ceil(filtered.length / 25)), safePage = Math.min(page, pageCount)
  return <section aria-label="Affected records" className="min-w-0 rounded-lg border border-emerald-100 bg-white p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-black text-slate-900">Affected records ({records.length})</h3><input type="search" aria-label="Search affected units" value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} placeholder="Find a unit or record" className="min-h-11 max-w-full rounded-lg border border-emerald-200 px-3 text-xs" /></div>
    <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[460px] text-left text-xs"><thead className="bg-emerald-50"><tr><th className="p-2">Unit / record</th><th className="p-2">Before</th><th className="p-2">After</th></tr></thead><tbody className="divide-y divide-emerald-50">{filtered.slice((safePage - 1) * 25, safePage * 25).map((row, index) => {
      const changes = auditChanges(row.before, row.after)
      return <tr key={`${row.entityId || row.unitId}-${index}`}><th scope="row" className="p-2 align-top font-semibold text-slate-800">{row.unitNumber ? `Unit ${row.unitNumber}` : row.unitId ? `Unit ID ${row.unitId}` : auditLabel(row.entityName, entityLabels)}<span className="mt-1 block font-normal text-slate-500">{auditLabel(row.entityName || 'METER_READING', entityLabels)}{row.entityId ? ` #${row.entityId}` : ''}</span>{row.fullName && <span className="mt-1 block font-normal">{row.fullName}</span>}</th><td className="max-w-64 whitespace-pre-wrap break-words p-2 align-top text-slate-500">{row.before === null ? 'None' : changes.length ? changes.map(change => `${change.label}: ${change.before}`).join('\n') : 'Not recorded'}</td><td className="max-w-64 whitespace-pre-wrap break-words p-2 align-top text-emerald-900">{row.after === null ? 'None' : changes.length ? changes.map(change => `${change.label}: ${change.after}`).join('\n') : 'Not recorded'}</td></tr>
    })}</tbody></table></div>
    {!filtered.length && <p className="py-3 text-xs text-slate-500">No affected records match.</p>}
    <div className="audit-pagination mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span>{filtered.length} matching records · Page {safePage} of {pageCount}</span><div className="flex gap-2"><button type="button" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)} className={buttonClass}>Previous units</button><button type="button" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)} className={buttonClass}>Next units</button></div></div>
  </section>
}
