import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import NoticeToast from '../../components/NoticeToast'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

const label = (value) => String(value || '').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())

export default function BillingErrorsPage() {
  const { token, user } = useAuth()
  const [status, setStatus] = useState('OPEN')
  const [reports, setReports] = useState([])
  const [notice, setNotice] = useState({ error: '', message: '' })
  const [busyId, setBusyId] = useState(null)
  const [resolutionTarget, setResolutionTarget] = useState(null)
  const [resolutionNote, setResolutionNote] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await apiRequest(`/api/billing-errors?status=${status}`, { token })
      setReports(data.reports)
    } catch (error) { setNotice({ error: error.message, message: '' }) }
  }, [status, token])

  useEffect(() => {
    let active = true
    apiRequest(`/api/billing-errors?status=${status}`, { token })
      .then((data) => { if (active) setReports(data.reports) })
      .catch((error) => { if (active) setNotice({ error: error.message, message: '' }) })
    return () => { active = false }
  }, [status, token])

  function openResolutionDialog(report) {
    setResolutionTarget(report)
    setResolutionNote('')
  }

  async function resolve(event) {
    event.preventDefault()
    const note = resolutionNote.trim()
    if (!resolutionTarget || note.length < 3) return
    setBusyId(resolutionTarget.id)
    setNotice({ error: '', message: '' })
    try {
      const data = await apiRequest(`/api/billing-errors/${resolutionTarget.id}/resolve`, { method: 'PATCH', token, body: { resolutionNote: note } })
      await load()
      setNotice({ error: '', message: data.message })
      setResolutionTarget(null)
      setResolutionNote('')
    } catch (error) { setNotice({ error: error.message, message: '' }) } finally { setBusyId(null) }
  }

  const billPath = user.role === 'ADMIN' ? '/admin/soa/bills' : '/collector/bills'
  return <DashboardLayout title="Billing Errors" description="Review resident reports about incorrect Statements of Account.">
    <NoticeToast key={notice.error || notice.message || 'empty'} error={notice.error} message={notice.message} />
    <Panel title="Resident billing-error reports" description="Resolve each report after correcting the SOA or confirming the billing details.">
      <div className="mb-5 flex gap-2"><button type="button" onClick={() => setStatus('OPEN')} className={`rounded-lg px-3 py-2 text-sm font-bold ${status === 'OPEN' ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-700'}`}>Open</button><button type="button" onClick={() => setStatus('RESOLVED')} className={`rounded-lg px-3 py-2 text-sm font-bold ${status === 'RESOLVED' ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-700'}`}>Resolved</button><button type="button" onClick={() => setStatus('ALL')} className={`rounded-lg px-3 py-2 text-sm font-bold ${status === 'ALL' ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-700'}`}>All</button></div>
      <div className="space-y-4">{reports.map((report) => <article key={report.id} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-col justify-between gap-3 sm:flex-row"><div><div className="flex flex-wrap items-center gap-2"><p className="font-black">Unit {report.unitNumber}</p><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${report.status === 'OPEN' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>{report.status}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{label(report.category)}</span></div><p className="mt-1 text-sm text-slate-500">Reported by {report.reportedByName} · SOA period {String(report.periodStart).slice(0, 10)}</p></div><Link to={`${billPath}/${report.billId}?from=billing-errors&reportId=${report.id}`} className="h-fit rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">Open and correct SOA</Link></div><p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{report.description}</p>{report.status === 'RESOLVED' ? <p className="mt-3 text-sm"><span className="font-bold">Resolution:</span> {report.resolutionNote}</p> : <button type="button" disabled={busyId === report.id} onClick={() => openResolutionDialog(report)} className="mt-4 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Resolve report</button>}</article>)}</div>
      {!reports.length && <EmptyRow message={status === 'OPEN' ? 'No open billing-error reports.' : 'No billing-error reports match this filter.'} />}
    </Panel>
    {resolutionTarget && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4 backdrop-blur-[1px]" role="presentation" onMouseDown={() => { if (!busyId) setResolutionTarget(null) }}>
      <section role="dialog" aria-modal="true" aria-labelledby="resolve-report-title" className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-white p-5 shadow-2xl sm:p-6" onMouseDown={(event) => event.stopPropagation()}>
        <h2 id="resolve-report-title" className="text-lg font-black text-[var(--ink)]">Resolve billing error</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Add a clear note for the resident. It will appear in their notification and on the SOA report.</p>
        <form onSubmit={resolve} className="mt-5">
          <label className="block text-sm font-bold text-[var(--ink)]">Resolution note<textarea required minLength="3" maxLength="1500" autoFocus value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} placeholder="Explain what was corrected or confirmed..." className="mt-2 min-h-28 w-full resize-y rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm font-normal text-[var(--ink)] outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" /></label>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" disabled={Boolean(busyId)} onClick={() => setResolutionTarget(null)} className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-bold text-[var(--ink)] disabled:opacity-50">Cancel</button><button disabled={Boolean(busyId) || resolutionNote.trim().length < 3} className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">{busyId ? 'Resolving...' : 'Resolve report'}</button></div>
        </form>
      </section>
    </div>}
  </DashboardLayout>
}
