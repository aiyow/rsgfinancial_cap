import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

const label = (value) => String(value || '').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())

export default function BillingErrorsPage() {
  const { token, user } = useAuth()
  const [status, setStatus] = useState('OPEN')
  const [reports, setReports] = useState([])
  const [notice, setNotice] = useState({ error: '', message: '' })
  const [busyId, setBusyId] = useState(null)

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

  async function resolve(report) {
    const resolutionNote = window.prompt('Resolution note for the resident:')
    if (!resolutionNote) return
    setBusyId(report.id)
    setNotice({ error: '', message: '' })
    try {
      const data = await apiRequest(`/api/billing-errors/${report.id}/resolve`, { method: 'PATCH', token, body: { resolutionNote } })
      await load()
      setNotice({ error: '', message: data.message })
    } catch (error) { setNotice({ error: error.message, message: '' }) } finally { setBusyId(null) }
  }

  const billPath = user.role === 'ADMIN' ? '/admin/soa/bills' : '/collector/bills'
  return <DashboardLayout title="Billing Errors" description="Review resident reports about incorrect Statements of Account.">
    {(notice.error || notice.message) && <p className={`rounded-lg p-3 text-sm ${notice.error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{notice.error || notice.message}</p>}
    <Panel title="Resident billing-error reports" description="Resolve each report after correcting the SOA or confirming the billing details.">
      <div className="mb-5 flex gap-2"><button type="button" onClick={() => setStatus('OPEN')} className={`rounded-lg px-3 py-2 text-sm font-bold ${status === 'OPEN' ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-700'}`}>Open</button><button type="button" onClick={() => setStatus('RESOLVED')} className={`rounded-lg px-3 py-2 text-sm font-bold ${status === 'RESOLVED' ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-700'}`}>Resolved</button><button type="button" onClick={() => setStatus('ALL')} className={`rounded-lg px-3 py-2 text-sm font-bold ${status === 'ALL' ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-700'}`}>All</button></div>
      <div className="space-y-4">{reports.map((report) => <article key={report.id} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-col justify-between gap-3 sm:flex-row"><div><div className="flex flex-wrap items-center gap-2"><p className="font-black">Unit {report.unitNumber}</p><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${report.status === 'OPEN' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>{report.status}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{label(report.category)}</span></div><p className="mt-1 text-sm text-slate-500">Reported by {report.reportedByName} · SOA period {String(report.periodStart).slice(0, 10)}</p></div><Link to={`${billPath}/${report.billId}?from=billing-errors&reportId=${report.id}`} className="h-fit rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">Open and correct SOA</Link></div><p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{report.description}</p>{report.status === 'RESOLVED' ? <p className="mt-3 text-sm"><span className="font-bold">Resolution:</span> {report.resolutionNote}</p> : <button type="button" disabled={busyId === report.id} onClick={() => resolve(report)} className="mt-4 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Resolve report</button>}</article>)}</div>
      {!reports.length && <EmptyRow message={status === 'OPEN' ? 'No open billing-error reports.' : 'No billing-error reports match this filter.'} />}
    </Panel>
  </DashboardLayout>
}
