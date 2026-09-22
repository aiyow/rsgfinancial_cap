import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronDown, Mail, RotateCcw } from 'lucide-react'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import NoticeToast from '../../components/NoticeToast'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

function emailSummaryMessage(summary) {
  if (!summary) return ''
  const parts = []
  if (summary.queued) parts.push(`${summary.queued} email${summary.queued === 1 ? '' : 's'} queued`)
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
const SOAS_PER_PAGE = 10

function FilterPopover({ label, onSelect, onToggle, open, options, value }) {
  const selected = options.find((option) => option.value === value) || options[0]

  return (
    <div className="relative min-w-0">
      <p className="mb-1 text-xs font-bold text-slate-600">{label}</p>
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex h-[42px] w-full min-w-0 items-center justify-between gap-3 overflow-hidden rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-left text-sm text-slate-700 outline-none transition hover:border-[#2f8f5b]">
        <span className="min-w-0 truncate">{selected.label}</span>
        <ChevronDown size={17} className={`shrink-0 text-slate-500 transition ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute inset-x-0 top-[calc(100%+8px)] z-30 max-h-60 overflow-y-auto rounded-xl border border-[#d7eadc] bg-white p-3 shadow-xl">
          <div className="grid gap-1">
            {options.map((option) => <button key={option.value} type="button" onClick={() => onSelect(option.value)} className={`rounded-lg px-2.5 py-2 text-left text-xs font-bold transition ${value === option.value ? 'bg-[#2f8f5b] text-white' : 'text-[#466653] hover:bg-[#effaf2] hover:text-[#2f8f5b]'}`}>{option.label}</button>)}
          </div>
        </div>
      )}
    </div>
  )
}

export default function AdminSoaBatchPage() {
  const { periodId } = useParams()
  const { token } = useAuth()
  const [bills, setBills] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [search, setSearch] = useState('')
  const [publishFilter, setPublishFilter] = useState('ALL')
  const [deliveryFilter, setDeliveryFilter] = useState('ALL')
  const [publishMenuOpen, setPublishMenuOpen] = useState(false)
  const [deliveryMenuOpen, setDeliveryMenuOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState({ error: '', message: '' })
  const [publishConfirmation, setPublishConfirmation] = useState(null)

  const publishedCount = useMemo(() => bills.filter((bill) => bill.publishedAt).length, [bills])
  const unpublished = useMemo(() => bills.filter((bill) => !bill.publishedAt), [bills])
  const publishSelectedDisabled = busy || selectedIds.length === 0
  const filteredBills = useMemo(() => {
    const term = search.trim().toLowerCase()
    return bills
      .filter((bill) => (!term || `${bill.unitNumber} ${bill.payerName || ''}`.toLowerCase().includes(term))
        && (publishFilter === 'ALL' || (publishFilter === 'PUBLISHED' ? Boolean(bill.publishedAt) : !bill.publishedAt))
        && (deliveryFilter === 'ALL' || (bill.publishedAt && deliveryMatches(bill.emailDelivery, deliveryFilter))))
      .sort((left, right) => unitNumberCollator.compare(String(left.unitNumber), String(right.unitNumber)))
  }, [bills, deliveryFilter, publishFilter, search])
  const totalPages = Math.max(1, Math.ceil(filteredBills.length / SOAS_PER_PAGE))
  const currentPage = Math.min(page, totalPages)
  const firstBillIndex = (currentPage - 1) * SOAS_PER_PAGE
  const visibleBills = filteredBills.slice(firstBillIndex, firstBillIndex + SOAS_PER_PAGE)
  const lastBillIndex = Math.min(firstBillIndex + SOAS_PER_PAGE, filteredBills.length)

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
      const deliveryMessage = data.emailsSending
        ? ` ${data.emailQueuedCount} email${data.emailQueuedCount === 1 ? '' : 's'} are sending in the background.`
        : body.sendEmails === false
          ? ' Published without sending email.'
          : ''
      setNotice({ error: '', message: `${data.message || successMessage}${deliveryMessage}${emailSummaryMessage(data.emailSummary)}` })
    } catch (error) {
      setNotice({ error: error.message, message: '' })
    } finally {
      setBusy(false)
    }
  }

  function requestPublishAll() {
    setPublishConfirmation({
      body: {}, count: unpublished.length, title: 'Publish all remaining SOAs?',
      message: 'Each resident with an active email recipient will be notified and can view their Statement of Account.',
      successMessage: 'Published every unpublished SOA in this batch.',
    })
  }

  function requestPublishSelected() {
    setPublishConfirmation({
      body: { billIds: selectedIds }, count: selectedIds.length, title: 'Publish selected SOAs?',
      message: 'Only the selected residents will receive and be able to view these Statements of Account.',
      successMessage: 'Published the selected SOAs.',
    })
  }

  async function confirmPublish(sendEmails) {
    if (!publishConfirmation) return
    const request = publishConfirmation
    setPublishConfirmation(null)
    await publish({ ...request.body, sendEmails }, request.successMessage)
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

  async function unpublishBill(bill) {
    const confirmed = window.confirm(`Hide the SOA for Unit ${bill.unitNumber} from the resident dashboard? Any email already sent cannot be recalled, but the resident will no longer be able to open the SOA. You can correct and publish it again afterward.`)
    if (!confirmed) return
    setBusy(true)
    setNotice({ error: '', message: '' })
    try {
      const data = await apiRequest(`/api/billing-periods/${periodId}/bills/${bill.id}/unpublish`, { method: 'POST', token })
      const refreshed = await apiRequest(`/api/bills?billingPeriodId=${periodId}`, { token })
      setBills(refreshed.bills)
      setNotice({ error: '', message: data.message })
    } catch (error) {
      setNotice({ error: error.message, message: '' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <DashboardLayout title="Forwarded billing batch" description="Open any read-only Statement of Account in this batch.">
      <div><Link to="/admin/soa" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold">Back to forwarded batches</Link></div>
      <NoticeToast key={notice.error || notice.message || 'empty'} error={notice.error} message={notice.message} />
      <Panel title={`${bills.length} Statements of Account`} description={`${publishedCount} published to Residents | ${unpublished.length} still hidden`}>
        <div className="mb-5 flex flex-wrap gap-3">
          <button disabled={busy || unpublished.length === 0} onClick={requestPublishAll} className="rounded-lg border border-[#75ba8e] bg-white px-4 py-2 text-sm font-bold text-[#237a4a] shadow-sm transition hover:border-[#237a4a] hover:bg-[#2f8f5b] hover:text-white hover:shadow-md focus:bg-[#2f8f5b] focus:text-white focus:outline-none focus:ring-2 focus:ring-[#2f8f5b] focus:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-white disabled:text-slate-400 disabled:shadow-none">Publish all remaining</button>
          <button type="button" disabled={publishSelectedDisabled} aria-disabled={publishSelectedDisabled} title={publishSelectedDisabled ? 'Select at least one hidden SOA to publish.' : 'Publish the selected SOAs.'} onClick={requestPublishSelected} className={`rounded-lg border px-4 py-2 text-sm font-bold shadow-sm transition focus:outline-none focus:ring-2 focus:ring-[#2f8f5b] focus:ring-offset-2 ${publishSelectedDisabled ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 shadow-none' : 'border-[#75ba8e] bg-white text-[#237a4a] hover:border-[#237a4a] hover:bg-[#2f8f5b] hover:text-white hover:shadow-md focus:bg-[#2f8f5b] focus:text-white active:scale-[0.98]'}`}>Publish selected{selectedIds.length ? ` (${selectedIds.length})` : ''}</button>
        </div>
        <div className="mb-4 rounded-xl border border-slate-100 bg-slate-50 p-4"><p className="mb-3 text-sm font-black text-slate-800">Filter Statements of Account</p><div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_170px_180px]"><label className="text-xs font-bold text-slate-600">Search unit or payer<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="e.g. 401 or owner name" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal" /></label><FilterPopover label="Publication" value={publishFilter} open={publishMenuOpen} onToggle={() => { setPublishMenuOpen((current) => !current); setDeliveryMenuOpen(false) }} onSelect={(value) => { setPublishFilter(value); setPage(1); setPublishMenuOpen(false) }} options={[{ value: 'ALL', label: 'All SOAs' }, { value: 'PUBLISHED', label: 'Published' }, { value: 'HIDDEN', label: 'Hidden' }]} /><FilterPopover label="Email delivery" value={deliveryFilter} open={deliveryMenuOpen} onToggle={() => { setDeliveryMenuOpen((current) => !current); setPublishMenuOpen(false) }} onSelect={(value) => { setDeliveryFilter(value); setPage(1); setDeliveryMenuOpen(false) }} options={[{ value: 'ALL', label: 'All statuses' }, { value: 'SENT', label: 'Sent' }, { value: 'FAILED', label: 'Failed' }, { value: 'PENDING', label: 'Pending' }, { value: 'NO_RECIPIENTS', label: 'No recipients' }]} /></div></div>
        <p className="mb-3 text-sm text-slate-500">Showing {filteredBills.length ? `${firstBillIndex + 1}-${lastBillIndex}` : 0} of {filteredBills.length} matching SOAs ({bills.length} total), sorted by unit number.</p>
        <div className="overflow-x-auto rounded-xl border border-slate-100"><table className="w-full min-w-[1080px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Select</th><th className="px-4 py-3">Unit</th><th className="px-4 py-3">Payer</th><th className="px-4 py-3">Due date</th><th className="px-4 py-3">Publish status</th><th className="px-4 py-3">Email delivery</th><th className="px-4 py-3">Total</th><th className="px-4 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-slate-300">{visibleBills.map((bill) => <tr key={bill.id} className="hover:bg-slate-50"><td className="px-4 py-3"><input type="checkbox" checked={selectedIds.includes(bill.id)} disabled={Boolean(bill.publishedAt)} onChange={() => toggleSelection(bill.id)} /></td><td className="px-4 py-3 font-black">Unit {bill.unitNumber}</td><td className="px-4 py-3">{bill.payerName || 'Unassigned'}</td><td className="px-4 py-3 whitespace-nowrap">{String(bill.dueDate).slice(0, 10)}</td><td className="px-4 py-3">{bill.publishedAt ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">Published</span> : <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">Hidden</span>}</td><td className="px-4 py-3">{bill.publishedAt && <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${Number(bill.emailDelivery?.failed || 0) ? 'bg-rose-50 text-rose-700' : 'bg-sky-50 text-sky-700'}`}>{deliveryLabel(bill.emailDelivery)}</span>}</td><td className="px-4 py-3 font-black whitespace-nowrap">PHP {Number(bill.totalAmount).toFixed(2)}</td><td className="px-4 py-3"><div className="flex justify-end gap-2"><Link className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700" to={`/admin/soa/bills/${bill.id}`}>{bill.publishedAt ? 'Open SOA' : 'Review / Publish'}</Link>{bill.publishedAt && <button type="button" disabled={busy} onClick={() => unpublishBill(bill)} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 transition hover:bg-amber-100 disabled:opacity-50">Unpublish</button>}{bill.publishedAt && Number(bill.emailDelivery?.failed || 0) > 0 && <button type="button" disabled={busy} onClick={() => retryEmail(bill)} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 disabled:opacity-50"><RotateCcw size={14} />Retry email</button>}{bill.publishedAt && (Number(bill.emailDelivery?.sent || 0) + Number(bill.emailDelivery?.failed || 0)) > 0 && <button type="button" disabled={busy} onClick={() => resendEmail(bill)} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"><Mail size={14} />Resend SOA</button>}</div></td></tr>)}</tbody></table></div>
        {filteredBills.length > 0 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-500">Page {currentPage} of {totalPages}</p><div className="flex gap-2"><button type="button" disabled={currentPage === 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50">Previous</button><button type="button" disabled={currentPage === totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50">Next</button></div></div>}
        {bills.length === 0 && <EmptyRow message="No forwarded SOAs found for this batch." />}
        {bills.length > 0 && filteredBills.length === 0 && <EmptyRow message="No SOAs match the selected filters." />}
      </Panel>
      {publishConfirmation && <PublishConfirmationModal confirmation={publishConfirmation} busy={busy} onCancel={() => setPublishConfirmation(null)} onPublishOnly={() => confirmPublish(false)} onPublishAndSend={() => confirmPublish(true)} />}
    </DashboardLayout>
  )
}

function PublishConfirmationModal({ busy, confirmation, onCancel, onPublishOnly, onPublishAndSend }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-4" role="presentation" onMouseDown={busy ? undefined : onCancel}>
      <section role="dialog" aria-modal="true" aria-labelledby="publish-confirmation-title" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl sm:p-6" onMouseDown={(event) => event.stopPropagation()}>
        <h2 id="publish-confirmation-title" className="text-xl font-black text-slate-900">{confirmation.title}</h2>
        <p className="mt-2 text-sm text-slate-600">You are about to publish <strong>{confirmation.count}</strong> Statement{confirmation.count === 1 ? '' : 's'} of Account.</p>
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{confirmation.message}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-3"><button type="button" disabled={busy} onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50">Cancel</button><button type="button" disabled={busy} onClick={onPublishOnly} className="rounded-lg border border-[#75ba8e] bg-white px-4 py-2.5 text-sm font-bold text-[#237a4a] transition hover:bg-[#effaf2] disabled:opacity-50">{busy ? 'Publishing...' : 'Publish only'}</button><button type="button" disabled={busy} onClick={onPublishAndSend} className="rounded-lg bg-[#2f8f5b] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#237a4a] disabled:opacity-50">{busy ? 'Publishing...' : 'Publish & send emails'}</button></div>
      </section>
    </div>
  )
}
