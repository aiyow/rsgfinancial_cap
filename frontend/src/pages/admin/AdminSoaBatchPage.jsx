import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Mail, RotateCcw } from 'lucide-react'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

function emailSummaryMessage(summary) {
  if (!summary) return ''
  const parts = []
  if (summary.sent) parts.push(`${summary.sent} email${summary.sent === 1 ? '' : 's'} sent`)
  if (summary.failed) parts.push(`${summary.failed} failed`)
  if (summary.skipped) parts.push(`${summary.skipped} SOA${summary.skipped === 1 ? '' : 's'} had no active email recipient`)
  return parts.length ? ` Email delivery: ${parts.join(', ')}.` : ''
}

function deliveryLabel(delivery) {
  if (!delivery) return 'Not sent'
  const sent = Number(delivery.sent || 0)
  const failed = Number(delivery.failed || 0)
  const pending = Number(delivery.pending || 0)
  if (failed) return `${sent} sent, ${failed} failed`
  if (pending) return `${pending} pending`
  if (sent) return `${sent} sent`
  return 'No active recipients'
}

function deliveryMatches(delivery, filter) {
  const sent = Number(delivery?.sent || 0)
  const failed = Number(delivery?.failed || 0)
  const pending = Number(delivery?.pending || 0)
  if (filter === 'SENT') return sent > 0
  if (filter === 'FAILED') return failed > 0
  if (filter === 'PENDING') return pending > 0
  if (filter === 'NO_RECIPIENTS') return sent + failed + pending === 0
  return true
}

const unitNumberCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export default function AdminSoaBatchPage() {
  const { periodId } = useParams()
  const { token } = useAuth()
  const [bills, setBills] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [search, setSearch] = useState('')
  const [publishFilter, setPublishFilter] = useState('ALL')
  const [deliveryFilter, setDeliveryFilter] = useState('ALL')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState({ error: '', message: '' })

  const publishedCount = useMemo(() => bills.filter((bill) => bill.publishedAt).length, [bills])
  const unpublished = useMemo(() => bills.filter((bill) => !bill.publishedAt), [bills])
  const filteredBills = useMemo(() => {
    const term = search.trim().toLowerCase()
    return bills
      .filter((bill) => (!term || `${bill.unitNumber} ${bill.payerName || ''}`.toLowerCase().includes(term))
        && (publishFilter === 'ALL' || (publishFilter === 'PUBLISHED' ? Boolean(bill.publishedAt) : !bill.publishedAt))
        && (deliveryFilter === 'ALL' || (bill.publishedAt && deliveryMatches(bill.emailDelivery, deliveryFilter))))
      .sort((left, right) => unitNumberCollator.compare(String(left.unitNumber), String(right.unitNumber)))
  }, [bills, deliveryFilter, publishFilter, search])

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
      setNotice({ error: '', message: `${data.message || successMessage}${emailSummaryMessage(data.emailSummary)}` })
    } catch (error) {
      setNotice({ error: error.message, message: '' })
    } finally {
      setBusy(false)
    }
  }

  async function retryEmail(bill) {
    setBusy(true)
    setNotice({ error: '', message: '' })
    try {
      const data = await apiRequest(`/api/billing-periods/${periodId}/bills/${bill.id}/email-deliveries/retry`, { method: 'POST', token })
      const refreshed = await apiRequest(`/api/bills?billingPeriodId=${periodId}`, { token })
      setBills(refreshed.bills)
      setNotice({ error: '', message: `${data.message}${emailSummaryMessage(data.emailSummary)}` })
    } catch (error) {
      setNotice({ error: error.message, message: '' })
    } finally {
      setBusy(false)
    }
  }

  async function resendEmail(bill) {
    if (!window.confirm(`Resend the SOA for Unit ${bill.unitNumber} to all saved recipients?`)) return
    setBusy(true)
    setNotice({ error: '', message: '' })
    try {
      const data = await apiRequest(`/api/billing-periods/${periodId}/bills/${bill.id}/email-deliveries/resend`, { method: 'POST', token })
      const refreshed = await apiRequest(`/api/bills?billingPeriodId=${periodId}`, { token })
      setBills(refreshed.bills)
      setNotice({ error: '', message: `${data.message}${emailSummaryMessage(data.emailSummary)}` })
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
        <div className="mb-4 rounded-xl border border-slate-100 bg-slate-50 p-4"><p className="mb-3 text-sm font-black text-slate-800">Filter Statements of Account</p><div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_170px_180px]"><label className="text-xs font-bold text-slate-600">Search unit or payer<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="e.g. 401 or owner name" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal" /></label><label className="text-xs font-bold text-slate-600">Publication<select value={publishFilter} onChange={(event) => setPublishFilter(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal"><option value="ALL">All SOAs</option><option value="PUBLISHED">Published</option><option value="HIDDEN">Hidden</option></select></label><label className="text-xs font-bold text-slate-600">Email delivery<select value={deliveryFilter} onChange={(event) => setDeliveryFilter(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal"><option value="ALL">All statuses</option><option value="SENT">Sent</option><option value="FAILED">Failed</option><option value="PENDING">Pending</option><option value="NO_RECIPIENTS">No recipients</option></select></label></div></div>
        <p className="mb-3 text-sm text-slate-500">Showing {filteredBills.length} of {bills.length} SOAs, sorted by unit number.</p>
        <div className="overflow-x-auto rounded-xl border border-slate-100"><table className="w-full min-w-[1080px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Select</th><th className="px-4 py-3">Unit</th><th className="px-4 py-3">Payer</th><th className="px-4 py-3">Due date</th><th className="px-4 py-3">Publish status</th><th className="px-4 py-3">Email delivery</th><th className="px-4 py-3">Total</th><th className="px-4 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{filteredBills.map((bill) => <tr key={bill.id} className="hover:bg-slate-50"><td className="px-4 py-3"><input type="checkbox" checked={selectedIds.includes(bill.id)} disabled={Boolean(bill.publishedAt)} onChange={() => toggleSelection(bill.id)} /></td><td className="px-4 py-3 font-black">Unit {bill.unitNumber}</td><td className="px-4 py-3">{bill.payerName || 'Unassigned'}</td><td className="px-4 py-3 whitespace-nowrap">{String(bill.dueDate).slice(0, 10)}</td><td className="px-4 py-3">{bill.publishedAt ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">Published</span> : <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">Hidden</span>}</td><td className="px-4 py-3">{bill.publishedAt && <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${Number(bill.emailDelivery?.failed || 0) ? 'bg-rose-50 text-rose-700' : 'bg-sky-50 text-sky-700'}`}>{deliveryLabel(bill.emailDelivery)}</span>}</td><td className="px-4 py-3 font-black whitespace-nowrap">PHP {Number(bill.totalAmount).toFixed(2)}</td><td className="px-4 py-3"><div className="flex justify-end gap-2"><Link className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700" to={`/admin/soa/bills/${bill.id}`}>{bill.publishedAt ? 'Open SOA' : 'Review / Publish'}</Link>{bill.publishedAt && Number(bill.emailDelivery?.failed || 0) > 0 && <button type="button" disabled={busy} onClick={() => retryEmail(bill)} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 disabled:opacity-50"><RotateCcw size={14} />Retry email</button>}{bill.publishedAt && (Number(bill.emailDelivery?.sent || 0) + Number(bill.emailDelivery?.failed || 0)) > 0 && <button type="button" disabled={busy} onClick={() => resendEmail(bill)} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"><Mail size={14} />Resend SOA</button>}</div></td></tr>)}</tbody></table></div>
        {bills.length === 0 && <EmptyRow message="No forwarded SOAs found for this batch." />}
        {bills.length > 0 && filteredBills.length === 0 && <EmptyRow message="No SOAs match the selected filters." />}
      </Panel>
    </DashboardLayout>
  )
}
