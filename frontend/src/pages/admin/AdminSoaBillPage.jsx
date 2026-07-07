import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import DashboardLayout from '../../components/DashboardLayout'
import SoaDocument from '../../components/SoaDocument'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

export default function AdminSoaBillPage() {
  const { id } = useParams()
  const { token } = useAuth()
  const [bill, setBill] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState({ error: '', message: '' })

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const data = await apiRequest(`/api/bills/${id}`, { token })
        if (active) setBill(data.bill)
      } catch (requestError) {
        if (active) setNotice({ error: requestError.message, message: '' })
      }
    }
    load()
    return () => { active = false }
  }, [id, token])

  async function publishBill() {
    if (!bill) return
    setBusy(true)
    setNotice({ error: '', message: '' })
    try {
      const data = await apiRequest(`/api/billing-periods/${bill.billingPeriodId}/publish`, {
        method: 'POST',
        token,
        body: { billIds: [bill.id] },
      })
      const refreshed = await apiRequest(`/api/bills/${id}`, { token })
      setBill(refreshed.bill)
      setNotice({ error: '', message: data.message })
    } catch (error) {
      setNotice({ error: error.message, message: '' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <DashboardLayout title="Forwarded Statement of Account" description="Read-only SOA received from the Collector.">
      <div className="print-hidden flex flex-wrap gap-3"><Link to={bill ? `/admin/soa/batches/${bill.billingPeriodId}` : '/admin/soa'} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold">Back to batch</Link><button onClick={() => window.print()} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white">Print / Save PDF</button>{bill && !bill.publishedAt && <button disabled={busy} onClick={publishBill} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold disabled:opacity-50">Publish this SOA</button>}</div>
      {(notice.error || notice.message) && <p className={`rounded-lg p-3 text-sm ${notice.error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{notice.error || notice.message}</p>}
      {!bill && !notice.error && <p className="text-sm text-slate-500">Loading statement...</p>}
      {bill && <SoaDocument bill={bill} />}
    </DashboardLayout>
  )
}
