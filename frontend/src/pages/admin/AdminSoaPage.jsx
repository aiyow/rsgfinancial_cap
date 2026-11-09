import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

function displayDate(value) {
  if (!value) return '—'
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date)
}

export default function AdminSoaPage() {
  const { token } = useAuth()
  const [periods, setPeriods] = useState([])
  const [error, setError] = useState('')

  const loadPeriods = useCallback(async () => {
    try {
      const data = await apiRequest('/api/billing-periods', { token })
      setPeriods(data.periods)
      setError('')
    } catch (requestError) {
      setError(requestError.message)
    }
  }, [token])

  useEffect(() => {
    const initialRefresh = window.setTimeout(loadPeriods, 0)
    const refreshInterval = window.setInterval(loadPeriods, 10_000)
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') loadPeriods() }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearTimeout(initialRefresh)
      window.clearInterval(refreshInterval)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [loadPeriods])

  return (
    <DashboardLayout title="Billing Batches" description="Statements of account forwarded by the Billing Associate.">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <Panel title="Billing Batches">
        <div className="space-y-3">
          {periods.map((period) => {
            const { soaCount, unpublishedSoaCount } = period
            const allPublished = soaCount > 0 && unpublishedSoaCount === 0
            const status = allPublished ? 'All Published' : `${unpublishedSoaCount} Unpublished SOA${unpublishedSoaCount === 1 ? '' : 's'}`
            return <article key={period.id} className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-black">{displayDate(period.periodStart)} to {displayDate(period.periodEnd)}</p>
                  <span className={`rounded-full px-2 py-1 text-xs font-bold ${allPublished ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{status}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">Due {displayDate(period.dueDate)} | Forwarded {displayDate(period.forwardedAt)}</p>
              </div>
              <Link to={`/admin/soa/batches/${period.id}`} className="w-fit rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold !text-white">Open batch</Link>
            </article>
          })}
        </div>
        {periods.length === 0 && <EmptyRow message="No billing batches have been forwarded." />}
      </Panel>
    </DashboardLayout>
  )
}
