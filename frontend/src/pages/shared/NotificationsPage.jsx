import { useCallback, useEffect, useState } from 'react'
import { Bell, CheckCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import DashboardLayout, { EmptyRow } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

const pageSize = 25

function notificationTime(value) {
  return value ? new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : ''
}

export default function NotificationsPage() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadNotifications = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize) })
      if (filter === 'unread') params.set('status', 'unread')
      const response = await apiRequest(`/api/notifications?${params}`, { token })
      setNotifications(response.notifications || [])
      setUnreadCount(response.unreadCount || 0)
      setTotalCount(response.totalCount || 0)
      setError('')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }, [filter, page, token])

  useEffect(() => { loadNotifications() }, [loadNotifications])

  async function markRead(notification) {
    if (!notification.readAt) await apiRequest(`/api/notifications/${notification.id}/read`, { method: 'PATCH', token })
    if (notification.href) navigate(notification.href)
    else loadNotifications()
  }

  async function markAllRead() {
    await apiRequest('/api/notifications/read-all', { method: 'PATCH', token })
    if (filter === 'unread' && page > 0) setPage(0)
    else loadNotifications()
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  return <DashboardLayout title="Notifications" description="Review new and previous portal notifications.">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><h1 className="text-2xl font-black tracking-tight text-[var(--ink)]">Notifications</h1><p className="mt-1 text-sm text-[var(--muted)]">{unreadCount ? `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}` : 'You are all caught up'}</p></div>
      {unreadCount > 0 && <button type="button" onClick={markAllRead} className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-bold text-[var(--primary)] shadow-sm transition hover:bg-[var(--app-bg)]"><CheckCheck size={17} />Mark all read</button>}
    </div>
    <section className="mt-6 overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] p-4"><div className="inline-flex rounded-lg bg-[var(--app-bg)] p-1"><button type="button" onClick={() => { setFilter('all'); setPage(0) }} className={`rounded-md px-3 py-1.5 text-sm font-bold transition ${filter === 'all' ? 'bg-white text-[var(--primary)] shadow-sm' : 'text-[var(--muted)]'}`}>All</button><button type="button" onClick={() => { setFilter('unread'); setPage(0) }} className={`rounded-md px-3 py-1.5 text-sm font-bold transition ${filter === 'unread' ? 'bg-white text-[var(--primary)] shadow-sm' : 'text-[var(--muted)]'}`}>Unread ({unreadCount})</button></div><p className="text-xs font-bold text-[var(--muted)]">{totalCount} total</p></div>
      {error && <p className="m-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading ? <div className="p-6"><EmptyRow message="Loading notifications..." /></div> : notifications.length ? <div className="divide-y divide-[var(--border)]">{notifications.map((notification) => <button key={notification.id} type="button" onClick={() => markRead(notification)} className={`block w-full px-5 py-4 text-left transition hover:bg-[var(--app-bg)] ${notification.readAt ? 'bg-white' : 'bg-emerald-50/60'}`}><span className="flex items-start justify-between gap-4"><span className="min-w-0"><span className="flex items-center gap-2"><Bell size={16} className="shrink-0 text-[var(--primary)]" /><strong className="text-sm text-[var(--ink)]">{notification.title}</strong>{!notification.readAt && <span className="size-2 shrink-0 rounded-full bg-[var(--primary)]" aria-label="Unread" />}</span><span className="mt-1.5 block text-sm text-[var(--muted)]">{notification.message}</span></span><time className="shrink-0 text-xs text-[var(--muted)]">{notificationTime(notification.createdAt)}</time></span></button>)}</div> : <div className="p-6"><EmptyRow message={filter === 'unread' ? 'No unread notifications.' : 'No notifications yet.'} /></div>}
      {totalCount > pageSize && <div className="flex items-center justify-between border-t border-[var(--border)] p-4"><button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-bold text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40">Previous</button><p className="text-xs font-bold text-[var(--muted)]">Page {page + 1} of {totalPages}</p><button type="button" disabled={page + 1 >= totalPages} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-bold text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40">Next</button></div>}
    </section>
  </DashboardLayout>
}
