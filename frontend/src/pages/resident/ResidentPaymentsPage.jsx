import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Clock3, X } from 'lucide-react'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import ResidentPaymentCard from '../../components/ResidentPaymentCard'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

const filters = ['ALL', 'PENDING', 'APPROVED', 'REJECTED']

export default function ResidentPaymentsPage() {
  const { token } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [status, setStatus] = useState(() => filters.includes(location.state?.filter) ? location.state.filter : 'ALL')
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [submissionNotice, setSubmissionNotice] = useState(() => location.state?.submissionNotice || '')

  useEffect(() => {
    if (!location.state?.submissionNotice) return
    let active = true
    queueMicrotask(() => {
      if (!active) return
      setSubmissionNotice(location.state.submissionNotice)
      if (filters.includes(location.state.filter)) setStatus(location.state.filter)
      navigate(location.pathname, { replace: true, state: null })
    })
    return () => { active = false }
  }, [location.pathname, location.state, navigate])

  useEffect(() => {
    let active = true
    queueMicrotask(() => { if (active) { setLoading(true); setError('') } })
    const query = status === 'ALL' ? '' : `?status=${status}`
    apiRequest(`/api/payments${query}`, { token })
      .then((data) => { if (active) setPayments(data.payments || []) })
      .catch((requestError) => { if (active) { setPayments([]); setError(requestError.message) } })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [status, token])

  return (
    <DashboardLayout title="My payment history" className="resident-shell resident-payments-shell">
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {submissionNotice && <section role="status" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 pl-3 py-2 text-emerald-950">
        <Clock3 size={17} className="mt-1 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1"><p className="text-xs font-black">Payment proof submitted</p><p className="mt-1 text-xs leading-5 text-emerald-800">{submissionNotice}</p></div>
        <button type="button" onClick={() => setSubmissionNotice('')} aria-label="Dismiss submission notice" className="grid size-11 shrink-0 place-items-center rounded-lg text-emerald-800 hover:bg-emerald-100"><X size={16} aria-hidden="true" /></button>
      </section>}

      <Panel className="resident-payments-panel" title="Payment history" description="Track proofs, payments, and issued invoices.">
        <div className="resident-payment-filters mb-3 grid grid-cols-4 gap-1 rounded-xl bg-slate-50 p-1 sm:max-w-md" role="group" aria-label="Filter payments by status">
          {filters.map((item) => (
            <button key={item} type="button" aria-pressed={status === item} onClick={() => setStatus(item)}
              className={`min-h-11 rounded-lg px-1 text-[11px] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-600 sm:text-xs ${status === item ? 'bg-emerald-700 text-white shadow-sm' : 'text-slate-600 hover:bg-emerald-50'}`}>
              {item === 'ALL' ? 'All' : item.toLowerCase()}
            </button>
          ))}
        </div>
        <div className={loading ? '' : 'grid items-start gap-2.5 lg:grid-cols-2 lg:gap-3'} aria-busy={loading}>
          {loading ? <PaymentHistorySkeleton /> : payments.map((payment) => <ResidentPaymentCard key={payment.id} payment={payment} />)}
        </div>
        {!loading && !error && payments.length === 0 && <EmptyRow message="No payment submissions match this filter yet." />}
      </Panel>
    </DashboardLayout>
  )
}

function PaymentHistorySkeleton() {
  return <div role="status" aria-label="Loading payment history" className="space-y-3 animate-pulse motion-reduce:animate-none">
    <span className="sr-only">Loading payment history…</span>
    {Array.from({ length: 3 }, (_, index) => <div key={index} className="rounded-xl border border-emerald-100 p-3.5"><div className="flex justify-between"><div className="h-4 w-20 rounded bg-emerald-100" /><div className="h-4 w-16 rounded bg-emerald-100" /></div><div className="mt-3 h-6 w-28 rounded bg-emerald-100" /><div className="mt-3 h-3 w-48 max-w-full rounded bg-slate-100" /><div className="mt-4 h-4 w-16 rounded bg-slate-100" /></div>)}
  </div>
}
