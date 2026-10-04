import { useEffect, useState } from 'react'
import useAuth from '../hooks/useAuth'
import { apiRequest } from '../services/api'
import { currency, purposeLabels } from '../utils/chargePayments'

export default function PaymentAllocationPreview({ request, onReady }) {
  const { token } = useAuth()
  const requestKey = JSON.stringify(request)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const body = JSON.parse(requestKey)
    queueMicrotask(() => { if (active) { setResult(null); setError(''); onReady('') } })
    if (!(body.amount > 0) || !body.paymentDate || (!body.paymentId && !body.targetBillId && !body.unitId)) return () => { active = false }
    const timer = setTimeout(async () => {
      try {
        const data = await apiRequest('/api/payments/allocation-preview', { method: 'POST', token, body })
        if (active) { setResult(data); onReady(requestKey) }
      } catch (failure) { if (active) setError(failure.message) }
    }, 400)
    return () => { active = false; clearTimeout(timer) }
  }, [requestKey, token, onReady])
  return <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs sm:col-span-2" aria-label="Payment allocation preview" aria-live="polite"><p className="font-black">Confirm designated amounts</p>
    {result ? <><dl className="mt-2 grid grid-cols-2 gap-2">{result.allocations.map(row => <div key={row.chargeType}><dt>{purposeLabels[row.chargeType]}</dt><dd className="mt-1 font-bold tabular-nums">{currency(row.allocatedAmount)}</dd></div>)}</dl><p className="mt-2 text-slate-600">{result.message}</p></> : <p className="mt-2 text-slate-600">{error || 'Enter amount, payment date, and target to preview allocation before saving.'}</p>}
  </section>
}
