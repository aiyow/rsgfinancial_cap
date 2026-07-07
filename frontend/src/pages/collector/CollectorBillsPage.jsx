import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import DashboardLayout, { EmptyRow } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

const actionClass = 'rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50'
const dateOnly = (value) => value ? String(value).slice(0, 10) : ''

export default function CollectorBillsPage() {
  const { token } = useAuth()
  const [periods, setPeriods] = useState([])
  const [bills, setBills] = useState([])
  const [busyId, setBusyId] = useState(null)
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
    } catch (error) {
      setNotice({ error: error.message, message: '' })
    } finally { setBusyId(null) }
  }

  function reopen(period) {
    const reason = window.prompt('Why are you reopening this generated batch?')
    if (reason === null) return
    run(period, `/api/billing-periods/${period.id}/reopen`, 'POST', { reason }, 'Batch reopened.')
  }

  function remove(period) {
    const forwardedWarning = period.status === 'FORWARDED' ? ' Admin will immediately lose access to every SOA in this batch.' : ''
    if (!window.confirm(`Permanently delete this ${period.status.toLowerCase()} batch, its readings, and all generated SOAs?${forwardedWarning} This cannot be undone.`)) return
    const reason = window.prompt('Reason for permanently deleting this billing batch:')
    if (reason === null) return
    run(period, `/api/billing-periods/${period.id}`, 'DELETE', { reason: reason || 'Collector deleted an incorrect billing batch.' }, 'Billing batch deleted.')
  }

  function forward(period) {
    if (!window.confirm('Forward this entire billing batch to Admin? It will become read-only.')) return
    run(period, `/api/billing-periods/${period.id}/forward`, 'POST', undefined, 'Batch forwarded.')
  }

  return (
    <DashboardLayout title="Billing batches and SOAs" description="Correct, regenerate, forward, and review monthly billing batches.">
      {(notice.error || notice.message) && <p className={`rounded-lg p-3 text-sm ${notice.error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{notice.error || notice.message}</p>}
      <div className="space-y-5">
        {periods.map((period) => {
          const periodBills = bills.filter((bill) => String(bill.billingPeriodId) === String(period.id))
          return <section key={period.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-black">{dateOnly(period.periodStart)} to {dateOnly(period.periodEnd)}</h2><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">{period.status}</span></div><p className="mt-1 text-sm text-slate-500">Due {dateOnly(period.dueDate)} | Water PHP {period.waterRatePerCubicM}/m3 | Dues PHP {period.associationDuesRatePerSqm}/sqm | {periodBills.length} SOAs</p></div>
              <div className="flex flex-wrap gap-2 print-hidden">
                {period.status === 'DRAFT' && <><Link to={`/collector/billing?periodId=${period.id}`} className={actionClass}>Edit draft</Link><button disabled={busyId === period.id} onClick={() => remove(period)} className={`${actionClass} text-red-600`}>Delete batch</button></>}
                {period.status === 'GENERATED' && <><button disabled={busyId === period.id} onClick={() => reopen(period)} className={actionClass}>Reopen batch</button><button disabled={busyId === period.id} onClick={() => remove(period)} className={`${actionClass} text-red-600`}>Delete batch</button><button disabled={busyId === period.id} onClick={() => forward(period)} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white disabled:bg-slate-300">Forward to Admin</button></>}
                {period.status === 'FORWARDED' && <button disabled={busyId === period.id} onClick={() => remove(period)} className={`${actionClass} text-red-600`}>Delete forwarded batch</button>}
              </div>
            </div>
            {periodBills.length > 0 && <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="text-xs uppercase text-slate-400"><tr><th className="pb-3">Unit</th><th>Payer</th><th>Statement date</th><th>Status</th><th>Total</th><th></th></tr></thead><tbody className="divide-y divide-slate-100">{periodBills.map((bill) => <tr key={bill.id}><td className="py-3 font-bold">Unit {bill.unitNumber}</td><td>{bill.payerName || 'Unassigned'}</td><td>{dateOnly(bill.statementDate)}</td><td>{bill.generationWarning ? <span className="font-bold text-amber-700">Reading warning</span> : <span className="text-emerald-700">Complete</span>}</td><td className="font-bold">PHP {Number(bill.totalAmount).toFixed(2)}</td><td><Link className="font-bold text-indigo-600" to={`/collector/bills/${bill.id}`}>{period.status === 'GENERATED' ? 'View / Edit' : 'View SOA'}</Link></td></tr>)}</tbody></table></div>}
          </section>
        })}
        {periods.length === 0 && <EmptyRow message="No billing batches found." />}
      </div>
    </DashboardLayout>
  )
}
