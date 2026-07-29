import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

const SOAS_PER_PAGE = 10
const unitNumberCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const dateOnly = (value) => value ? String(value).slice(0, 10) : ''

export default function CollectorBillBatchPage() {
  const { periodId } = useParams()
  const { token } = useAuth()
  const [bills, setBills] = useState([])
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [notice, setNotice] = useState({ error: '', message: '' })

  const sortedBills = useMemo(() => bills.slice().sort((left, right) => unitNumberCollator.compare(String(left.unitNumber), String(right.unitNumber))), [bills])
  const filteredBills = useMemo(() => {
    const searchTerm = search.trim().toLowerCase()
    if (!searchTerm) return sortedBills
    return sortedBills.filter((bill) => `${bill.unitNumber} ${bill.payerName || ''}`.toLowerCase().includes(searchTerm))
  }, [search, sortedBills])
  const totalPages = Math.max(1, Math.ceil(filteredBills.length / SOAS_PER_PAGE))
  const currentPage = Math.min(page, totalPages)
  const firstBillIndex = (currentPage - 1) * SOAS_PER_PAGE
  const visibleBills = filteredBills.slice(firstBillIndex, firstBillIndex + SOAS_PER_PAGE)
  const lastBillIndex = Math.min(firstBillIndex + SOAS_PER_PAGE, filteredBills.length)

  useEffect(() => {
    let active = true

    apiRequest(`/api/bills?billingPeriodId=${periodId}`, { token })
      .then((data) => { if (active) { setBills(data.bills); setPage(1) } })
      .catch((error) => { if (active) setNotice({ error: error.message, message: '' }) })

    return () => { active = false }
  }, [periodId, token])

  return (
    <DashboardLayout title="Billing batch" description="Review the Statements of Account in this billing batch.">
      <div><Link to="/collector/bills" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold">Back to batches</Link></div>
      {notice.error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{notice.error}</p>}
      <Panel title={`${bills.length} Statements of Account`} description="Showing 10 SOAs at a time, sorted by unit number.">
        <label className="mb-4 block max-w-md text-sm font-bold text-slate-700">Search by unit or payer
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="e.g. Unit 101 or Juan Dela Cruz" className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" />
        </label>
        <p className="mb-3 text-sm text-slate-500">Showing {filteredBills.length ? `${firstBillIndex + 1}-${lastBillIndex}` : 0} of {filteredBills.length} matching SOAs ({bills.length} total).</p>
        {filteredBills.length > 0 && <div className="max-h-[560px] overflow-auto rounded-xl border border-slate-100">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Unit</th><th className="px-4 py-3">Payer</th><th className="px-4 py-3">Statement date</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Total</th><th className="px-4 py-3">Action</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{visibleBills.map((bill) => <tr key={bill.id} className="hover:bg-slate-50"><td className="px-4 py-3 font-bold">Unit {bill.unitNumber}</td><td className="px-4 py-3">{bill.payerName || 'Unassigned'}</td><td className="px-4 py-3">{dateOnly(bill.statementDate)}</td><td className="px-4 py-3">{bill.generationWarning ? <span className="font-bold text-amber-700">Reading warning</span> : <span className="text-emerald-700">Complete</span>}</td><td className="px-4 py-3 font-bold whitespace-nowrap">PHP {Number(bill.totalAmount).toFixed(2)}</td><td className="px-4 py-3"><Link className="font-bold text-indigo-600" to={`/collector/bills/${bill.id}`}>{bill.status === 'GENERATED' ? 'View / Edit' : 'View SOA'}</Link></td></tr>)}</tbody>
          </table>
        </div>}
        {filteredBills.length > 0 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-500">Page {currentPage} of {totalPages}</p><div className="flex gap-2"><button type="button" disabled={currentPage === 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50">Previous</button><button type="button" disabled={currentPage === totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50">Next</button></div></div>}
        {bills.length === 0 && !notice.error && <EmptyRow message="No SOAs found for this batch." />}
        {bills.length > 0 && filteredBills.length === 0 && <EmptyRow message="No SOAs match your search." />}
      </Panel>
    </DashboardLayout>
  )
}
