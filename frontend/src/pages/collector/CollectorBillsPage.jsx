import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, X } from 'lucide-react'
import DashboardLayout, { EmptyRow } from '../../components/DashboardLayout'
import NoticeToast from '../../components/NoticeToast'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

const actionClass = 'inline-flex items-center justify-center whitespace-nowrap rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-bold leading-5 text-emerald-800 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-700 hover:bg-emerald-700 hover:text-white hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50'
const deleteForwardedClass = actionClass
function displayDate(value) {
  if (!value) return '—'
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date)
}

export default function CollectorBillsPage() {
  const { token } = useAuth()
  const [periods, setPeriods] = useState([])
  const [bills, setBills] = useState([])
  const [busyId, setBusyId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [reopenTarget, setReopenTarget] = useState(null)
  const [forwardTarget, setForwardTarget] = useState(null)
  const [notice, setNotice] = useState({ error: '', message: '' })

  const loadData = useCallback(async () => {
    const [periodData, billData] = await Promise.all([
      apiRequest('/api/billing-periods', { token }),
      apiRequest('/api/bills', { token }),
    ])
    setPeriods(periodData.periods)
    setBills(billData.bills)
  }, [token])

  useEffect(() => {
    let active = true
    Promise.all([apiRequest('/api/billing-periods', { token }), apiRequest('/api/bills', { token })])
      .then(([periodData, billData]) => { if (active) { setPeriods(periodData.periods); setBills(billData.bills) } })
      .catch((error) => { if (active) setNotice({ error: error.message, message: '' }) })
    return () => { active = false }
  }, [token])

  async function run(period, path, method, body, successPrompt) {
    setBusyId(period.id)
    setNotice({ error: '', message: '' })
    try {
      const data = await apiRequest(path, { method, token, body })
      await loadData()
      setNotice({ error: '', message: data.message || successPrompt })
      return true
    } catch (error) {
      setNotice({ error: error.message, message: '' })
      return false
    } finally { setBusyId(null) }
  }

  function reopen(period) {
    setReopenTarget(period)
  }

  async function confirmReopen(reason) {
    if (!reopenTarget) return false
    const reopened = await run(reopenTarget, `/api/billing-periods/${reopenTarget.id}/reopen`, 'POST', { reason: reason || 'Billing Associate reopened the batch for correction.' }, 'Batch reopened.')
    setReopenTarget(null)
    return reopened
  }

  function remove(period) {
    setDeleteTarget(period)
  }

  async function confirmDelete(currentPassword, reason) {
    if (!deleteTarget) return false
    const deleted = await run(deleteTarget, `/api/billing-periods/${deleteTarget.id}`, 'DELETE', { currentPassword, reason: reason || 'Billing Associate deleted an incorrect billing batch.' }, 'Billing batch deleted.')
    if (deleted) setDeleteTarget(null)
    return deleted
  }

  function forward(period) {
    setForwardTarget(period)
  }

  async function confirmForward() {
    if (!forwardTarget) return false
    const forwarded = await run(forwardTarget, `/api/billing-periods/${forwardTarget.id}/forward`, 'POST', undefined, 'Batch forwarded.')
    setForwardTarget(null)
    return forwarded
  }

  return (
    <DashboardLayout title="Billing batches and SOAs" description="Correct, regenerate, forward, and review monthly billing batches.">
      <NoticeToast key={notice.error || notice.message || 'empty'} error={notice.error} message={notice.message} />
      <div className="space-y-5">
        {periods.map((period) => {
          const periodBills = bills.filter((bill) => String(bill.billingPeriodId) === String(period.id))
          return <section key={period.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-black">{displayDate(period.periodStart)} to {displayDate(period.periodEnd)}</h2><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">{period.status}</span></div><p className="mt-1 text-sm text-slate-500">Due {displayDate(period.dueDate)} | Water PHP {period.waterRatePerCubicM}/m3 | Dues PHP {period.associationDuesRatePerSqm}/sqm | {Number(period.latePenaltyPercent || 0) > 0 ? `Late penalty ${Number(period.latePenaltyPercent).toFixed(2)}% once | ` : ''}{periodBills.length} SOAs</p></div>
              <div className="flex flex-wrap gap-2 print-hidden">
                {period.status === 'DRAFT' && <><Link to={`/collector/billing?periodId=${period.id}`} className={actionClass}>Edit draft</Link><button disabled={busyId === period.id} onClick={() => remove(period)} className={actionClass}>Delete batch</button></>}
                {period.status === 'GENERATED' && <><Link to={`/collector/bills/batches/${period.id}`} className={actionClass}>View batch</Link><button disabled={busyId === period.id} onClick={() => reopen(period)} className={actionClass}>Reopen batch</button><button disabled={busyId === period.id} onClick={() => remove(period)} className={actionClass}>Delete batch</button><button disabled={busyId === period.id} onClick={() => forward(period)} className={actionClass}>Forward to Admin</button></>}
                {period.status === 'FORWARDED' && <button disabled={busyId === period.id} onClick={() => remove(period)} className={deleteForwardedClass}>Delete forwarded batch</button>}
              </div>
            </div>
          </section>
        })}
        {periods.length === 0 && <EmptyRow message="No billing batches found." />}
      </div>
      {reopenTarget && <ReopenBatchModal period={reopenTarget} busy={busyId === reopenTarget.id} onCancel={() => setReopenTarget(null)} onConfirm={confirmReopen} />}
      {forwardTarget && <ForwardBatchModal period={forwardTarget} busy={busyId === forwardTarget.id} onCancel={() => setForwardTarget(null)} onConfirm={confirmForward} />}
      {deleteTarget && <DeleteBatchModal period={deleteTarget} busy={busyId === deleteTarget.id} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDelete} />}
    </DashboardLayout>
  )
}

function ReopenBatchModal({ busy, onCancel, onConfirm, period }) {
  const [reason, setReason] = useState('')

  async function submit(event) {
    event.preventDefault()
    await onConfirm(reason)
  }

  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-[1px]" role="presentation" onMouseDown={() => { if (!busy) onCancel() }}>
    <section role="dialog" aria-modal="true" aria-labelledby="reopen-batch-title" className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl sm:p-6" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4"><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700"><AlertTriangle size={21} aria-hidden="true" /></span><div><h2 id="reopen-batch-title" className="text-xl font-black text-slate-900">Reopen this batch?</h2><p className="mt-1 text-sm text-slate-600">Use this only when a correction is needed before forwarding to Admin.</p></div></div><button type="button" disabled={busy} onClick={onCancel} aria-label="Close reopen confirmation" className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 disabled:opacity-50"><X size={19} /></button></div>
      <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-slate-700"><p>The generated SOAs for <strong className="text-slate-900">{displayDate(period.periodStart)} to {displayDate(period.periodEnd)}</strong> will be removed and the batch will return to draft status.</p><p className="mt-2 font-bold text-amber-900">Saved meter readings will be preserved so you can make corrections and generate the batch again.</p></div>
      <form onSubmit={submit} className="mt-5 space-y-4"><label className="block text-sm font-bold text-slate-700">Reason for reopening <span className="font-normal text-slate-500">(optional)</span><textarea autoFocus value={reason} onChange={(event) => setReason(event.target.value)} maxLength="500" placeholder="Example: A water rate or reading needs correction." className="mt-1.5 min-h-24 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100" /></label><div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" disabled={busy} onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50">Keep generated batch</button><button disabled={busy} className="rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-amber-700 disabled:opacity-50">{busy ? 'Reopening…' : 'Reopen batch'}</button></div></form>
    </section>
  </div>
}

function ForwardBatchModal({ busy, onCancel, onConfirm, period }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-[1px]" role="presentation" onMouseDown={() => { if (!busy) onCancel() }}>
    <section role="dialog" aria-modal="true" aria-labelledby="forward-batch-title" className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl sm:p-6" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4"><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700"><AlertTriangle size={21} aria-hidden="true" /></span><div><h2 id="forward-batch-title" className="text-xl font-black text-slate-900">Forward batch to Admin?</h2><p className="mt-1 text-sm text-slate-600">Only forward after you have checked every generated statement.</p></div></div><button type="button" disabled={busy} onClick={onCancel} aria-label="Close forward confirmation" className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 disabled:opacity-50"><X size={19} /></button></div>
      <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-slate-700"><p>Forward the <strong className="text-slate-900">{displayDate(period.periodStart)} to {displayDate(period.periodEnd)}</strong> batch to Admin for review.</p><p className="mt-2 font-bold text-emerald-900">The batch will become read-only after forwarding.</p></div>
      <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" disabled={busy} onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50">Keep reviewing</button><button type="button" disabled={busy} onClick={onConfirm} className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:opacity-50">{busy ? 'Forwarding…' : 'Forward to Admin'}</button></div>
    </section>
  </div>
}

function DeleteBatchModal({ busy, onCancel, onConfirm, period }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [reason, setReason] = useState('')

  async function submit(event) {
    event.preventDefault()
    await onConfirm(currentPassword, reason)
  }

  const forwarded = period.status === 'FORWARDED'
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-[1px]" role="presentation" onMouseDown={() => { if (!busy) onCancel() }}>
      <section role="dialog" aria-modal="true" aria-labelledby="delete-batch-title" className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl sm:p-6" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4"><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-full bg-rose-100 text-rose-700"><AlertTriangle size={21} aria-hidden="true" /></span><div><h2 id="delete-batch-title" className="text-xl font-black text-slate-900">Delete billing batch?</h2><p className="mt-1 text-sm text-slate-600">This action cannot be undone.</p></div></div><button type="button" disabled={busy} onClick={onCancel} aria-label="Close delete confirmation" className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 disabled:opacity-50"><X size={19} /></button></div>
        <div className="mt-5 rounded-xl border border-rose-100 bg-rose-50 p-4 text-sm text-slate-700"><p>Permanently delete the <strong className="text-slate-900">{displayDate(period.periodStart)} to {displayDate(period.periodEnd)}</strong> batch, including its readings and generated statements.</p>{forwarded && <p className="mt-2 font-bold text-rose-800">Admin will immediately lose access to every statement in this forwarded batch.</p>}</div>
        <form onSubmit={submit} className="mt-5 space-y-4"><label className="block text-sm font-bold text-slate-700">Your current password<input required minLength="8" autoComplete="current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100" /></label><label className="block text-sm font-bold text-slate-700">Reason for deletion <span className="font-normal text-slate-500">(optional)</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength="500" placeholder="Example: Batch was generated with an incorrect water rate." className="mt-1.5 min-h-24 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100" /></label><div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" disabled={busy} onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50">Keep batch</button><button disabled={busy} className="rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-rose-700 disabled:opacity-50">{busy ? 'Deleting…' : 'Delete permanently'}</button></div></form>
      </section>
    </div>
  )
}
