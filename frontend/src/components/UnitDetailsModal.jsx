import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import useAuth from '../hooks/useAuth'
import { apiRequest } from '../services/api'
import { formatLabel } from '../utils/formatText'

const money = (value) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value || 0))
const date = (value) => value ? new Date(`${String(value).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC' }) : '—'
const sameId = (a, b) => String(a) === String(b)

// Mount with key={unitId} so a new unit starts with an empty loading state.
export default function UnitDetailsModal({ unitId, onClose }) {
  const { token, user } = useAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const dialogRef = useRef(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])

  useEffect(() => {
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current.focus()
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
      }
      if (event.key !== 'Tab') return
      const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]')]
        .filter((element) => element.getClientRects().length > 0)
      const first = controls[0], last = controls.at(-1)
      if (!controls.length) { event.preventDefault(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
        event.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const options = { token, signal: controller.signal }
    Promise.all([
      apiRequest(`/api/units/${unitId}`, options),
      apiRequest('/api/unit-assignments', options),
      apiRequest('/api/bills', options),
      apiRequest('/api/payments', options),
    ]).then(([unitData, assignmentData, billData, paymentData]) => {
      if (!active) return
      const bills = (billData.bills || []).filter((bill) => sameId(bill.unitId, unitId))
        .sort((a, b) => String(b.periodStart).localeCompare(String(a.periodStart)) || Number(b.id) - Number(a.id))
      const assignments = (assignmentData.assignments || []).filter((assignment) => sameId(assignment.unitId, unitId) && !assignment.endDate)
        .sort((a, b) => Number(b.isPrimaryPayer) - Number(a.isPrimaryPayer))
      const payments = (paymentData.payments || []).filter((payment) => sameId(payment.unitId, unitId) && payment.reviewStatus === 'APPROVED')
        .sort((a, b) => String(b.verifiedPaymentDate || b.submittedAt).localeCompare(String(a.verifiedPaymentDate || a.submittedAt)))
      setData({ unit: unitData.unit, assignments, bills, lastPayment: payments[0]?.verifiedPaymentDate || payments[0]?.submittedAt })
    }).catch((requestError) => { if (active) setError(requestError.message) })
    return () => { active = false; controller.abort() }
  }, [attempt, token, unitId])

  const billRoot = user.role === 'ADMIN' ? '/admin/soa/bills' : '/collector/bills'
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-3 sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="unit-details-title" tabIndex={-1} className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-4 text-[var(--ink)] shadow-xl outline-none sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div><h2 id="unit-details-title" className="text-xl font-black">{data ? `Unit ${data.unit.unitNumber}` : 'Unit details'}</h2><p className="mt-1 text-sm text-[var(--muted)]">Unit information, assigned accounts, and billing records.</p></div>
        <button type="button" onClick={onClose} aria-label="Close unit details" className="rounded-lg p-2 hover:bg-[var(--app-bg)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]"><X size={20} /></button>
      </div>
      {error ? <div role="alert" className="mt-5 rounded-lg bg-red-50 p-4 text-sm text-red-700"><p>{error}</p><button type="button" className="mt-2 font-bold underline" onClick={() => { setError(''); setAttempt((value) => value + 1) }}>Try again</button></div> : !data ? <p role="status" className="py-8 text-sm text-[var(--muted)]">Loading unit details…</p> : <div className="mt-5 space-y-5">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Unit number" value={data.unit.unitNumber} />
          <Detail label="Occupancy" value={formatLabel(data.unit.occupancyStatus)} />
          <Detail label="Floor" value={data.unit.floor || '—'} />
          <Detail label="Billable area" value={data.unit.billableAreaSqm ? `${data.unit.billableAreaSqm} sqm` : '—'} />
          <Detail label="Open balance" value={money(data.bills[0]?.remainingBalance)} />
          <Detail label="Last payment" value={date(data.lastPayment)} />
        </dl>
        <section className="rounded-xl border border-[var(--border)]">
          <h3 className="border-b border-[var(--border)] px-4 py-3 font-bold">Assigned accounts</h3>
          {data.assignments.length ? <ul className="divide-y divide-[var(--border)]">{data.assignments.map((assignment) => <li key={assignment.id} className="px-4 py-3"><p className="font-bold">{assignment.residentName}</p><p className="break-words text-sm text-[var(--muted)]">{formatLabel(assignment.relationshipType)}{assignment.isPrimaryPayer ? ' · Primary payer' : ''}</p></li>)}</ul> : <p className="p-4 text-sm text-[var(--muted)]">No active unit assignments.</p>}
        </section>
        <section aria-labelledby="unit-billing-title">
          <h3 id="unit-billing-title" className="font-bold">Billing history</h3>
          {data.bills.length ? <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--border)]"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-[var(--app-bg)]"><tr>{['Billing period', 'Due date', 'Total', 'Remaining balance', 'Status', 'Bill'].map((label) => <th key={label} className="px-3 py-3">{label}</th>)}</tr></thead><tbody className="divide-y divide-[var(--border)]">{data.bills.map((bill) => <tr key={bill.id}><td className="px-3 py-3">{date(bill.periodStart)} – {date(bill.periodEnd)}</td><td className="px-3 py-3">{date(bill.dueDate)}</td><td className="px-3 py-3">{money(bill.totalAmount)}</td><td className="px-3 py-3">{money(bill.remainingBalance)}</td><td className="px-3 py-3">{formatLabel(bill.paymentStatus)}</td><td className="px-3 py-3"><Link to={`${billRoot}/${bill.id}`} className="inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-bold !text-white shadow-sm transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2">View bill</Link></td></tr>)}</tbody></table></div> : <p className="mt-3 rounded-xl bg-[var(--app-bg)] p-4 text-sm text-[var(--muted)]">No billing records available for this unit.</p>}
        </section>
      </div>}
    </section>
  </div>
}

function Detail({ label, value }) {
  return <div className="rounded-xl bg-[var(--app-bg)] p-3"><dt className="text-xs font-bold text-[var(--muted)]">{label}</dt><dd className="mt-2 text-sm font-semibold">{value}</dd></div>
}
