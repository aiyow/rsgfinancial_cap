import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

export default function AdminSoaBatchPage() {
  const { periodId } = useParams()
  const { token } = useAuth()
  const [bills, setBills] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState({ error: '', message: '' })

  const publishedCount = useMemo(() => bills.filter((bill) => bill.publishedAt).length, [bills])
  const unpublished = useMemo(() => bills.filter((bill) => !bill.publishedAt), [bills])

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const data = await apiRequest(`/api/bills?billingPeriodId=${periodId}`, { token })
        if (!active) return
        setBills(data.bills)
        setSelectedIds((current) => current.filter((id) => data.bills.some((bill) => bill.id === id && !bill.publishedAt)))
      } catch (requestError) {
        if (active) setNotice({ error: requestError.message, message: '' })
      }
    }
    load()
    return () => { active = false }
  }, [periodId, token])

  function toggleSelection(billId) {
    setSelectedIds((current) => current.includes(billId) ? current.filter((id) => id !== billId) : [...current, billId])
  }

  async function publish(body, successMessage) {
    setBusy(true)
    setNotice({ error: '', message: '' })
    try {
      const data = await apiRequest(`/api/billing-periods/${periodId}/publish`, { method: 'POST', token, body })
      const refreshed = await apiRequest(`/api/bills?billingPeriodId=${periodId}`, { token })
      setBills(refreshed.bills)
      setSelectedIds([])
      setNotice({ error: '', message: data.message || successMessage })
    } catch (error) {
      setNotice({ error: error.message, message: '' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <DashboardLayout title="Forwarded billing batch" description="Open any read-only Statement of Account in this batch.">
      <div><Link to="/admin/soa" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold">Back to forwarded batches</Link></div>
      {(notice.error || notice.message) && <p className={`rounded-lg p-3 text-sm ${notice.error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{notice.error || notice.message}</p>}
      <Panel title={`${bills.length} Statements of Account`} description={`${publishedCount} published to Residents | ${unpublished.length} still hidden`}>
        <div className="mb-5 flex flex-wrap gap-3">
          <button disabled={busy || unpublished.length === 0} onClick={() => publish({}, 'Published every unpublished SOA in this batch.')} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:bg-slate-300">Publish all remaining</button>
          <button disabled={busy || selectedIds.length === 0} onClick={() => publish({ billIds: selectedIds }, 'Published the selected SOAs.')} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold disabled:opacity-50">Publish selected</button>
        </div>
        <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-sm"><thead className="text-xs uppercase text-slate-400"><tr><th className="pb-3">Select</th><th>Unit</th><th>Payer</th><th>Due date</th><th>Publish status</th><th>Total</th><th></th></tr></thead><tbody className="divide-y divide-slate-100">{bills.map((bill) => <tr key={bill.id}><td className="py-3"><input type="checkbox" checked={selectedIds.includes(bill.id)} disabled={Boolean(bill.publishedAt)} onChange={() => toggleSelection(bill.id)} /></td><td className="font-bold">Unit {bill.unitNumber}</td><td>{bill.payerName || 'Unassigned'}</td><td>{String(bill.dueDate).slice(0, 10)}</td><td>{bill.publishedAt ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">Published</span> : <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">Hidden</span>}</td><td className="font-bold">PHP {Number(bill.totalAmount).toFixed(2)}</td><td><Link className="font-bold text-indigo-600" to={`/admin/soa/bills/${bill.id}`}>{bill.publishedAt ? 'View SOA' : 'Review / Publish'}</Link></td></tr>)}</tbody></table></div>
        {bills.length === 0 && <EmptyRow message="No forwarded SOAs found for this batch." />}
      </Panel>
    </DashboardLayout>
  )
}
