import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, BellRing, CheckCheck } from 'lucide-react'
import { apiRequest } from '../services/api'

const POLL_INTERVAL_MS = 30_000

function notificationTime(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('en-PH', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value))
}

export default function NotificationCenter({ token }) {
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const [browserPermission, setBrowserPermission] = useState(() => (
    'Notification' in window ? window.Notification.permission : 'unsupported'
  ))
  const menuRef = useRef(null)
  const knownNotificationIds = useRef(new Set())
  const hasLoaded = useRef(false)
  const toastTimer = useRef(null)

  useEffect(() => {
    let active = true

    async function loadNotifications() {
      try {
        const response = await apiRequest('/api/notifications?limit=30', { token })
        if (!active) return
        const current = response.notifications || []
        const newNotifications = hasLoaded.current
          ? current.filter((notification) => !knownNotificationIds.current.has(notification.id))
          : []

        knownNotificationIds.current = new Set(current.map((notification) => notification.id))
        hasLoaded.current = true
        setNotifications(current)
        setUnreadCount(response.unreadCount || 0)

        if (newNotifications.length) {
          const newest = newNotifications[0]
          setToast(newest)
          window.clearTimeout(toastTimer.current)
          toastTimer.current = window.setTimeout(() => setToast(null), 7000)
          if (browserPermission === 'granted' && document.visibilityState !== 'visible') {
            new window.Notification(newest.title, { body: newest.message, tag: `rsg-notification-${newest.id}` })
          }
        }
      } catch {
        // Notifications should never prevent use of the portal if the service is temporarily unavailable.
      }
    }

    loadNotifications()
    const interval = window.setInterval(loadNotifications, POLL_INTERVAL_MS)
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') loadNotifications() }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      active = false
      window.clearInterval(interval)
      window.clearTimeout(toastTimer.current)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [browserPermission, token])

  useEffect(() => {
    if (!open) return undefined
    function closeOnOutsideClick(event) {
      if (!menuRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => document.removeEventListener('mousedown', closeOnOutsideClick)
  }, [open])

  async function markRead(notification) {
    if (!notification.readAt) {
      try {
        await apiRequest(`/api/notifications/${notification.id}/read`, { method: 'PATCH', token })
        setNotifications((current) => current.map((item) => (
          item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item
        )))
        setUnreadCount((current) => Math.max(0, current - 1))
      } catch {
        return
      }
    }
    setOpen(false)
    setToast(null)
    if (notification.href) navigate(notification.href)
  }

  async function markAllRead() {
    try {
      await apiRequest('/api/notifications/read-all', { method: 'PATCH', token })
      setNotifications((current) => current.map((notification) => ({ ...notification, readAt: notification.readAt || new Date().toISOString() })))
      setUnreadCount(0)
    } catch {
      // Leave the current state intact if the request did not complete.
    }
  }

  async function enableBrowserAlerts() {
    if (!('Notification' in window)) return
    const permission = await window.Notification.requestPermission()
    setBrowserPermission(permission)
  }

  return (
    <>
      <div ref={menuRef} className="relative shrink-0">
        <button
          type="button"
          aria-label={unreadCount ? `${unreadCount} unread notifications` : 'Open notifications'}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="relative grid size-10 place-items-center rounded-lg border border-[var(--border)] bg-white text-[var(--primary)] hover:bg-[var(--app-bg)]"
        >
          {unreadCount ? <BellRing size={19} aria-hidden="true" /> : <Bell size={19} aria-hidden="true" />}
          {unreadCount > 0 && <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-black leading-5 text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>}
        </button>

        {open && (
          <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-[min(23rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-xl">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
              <div><p className="font-bold text-[var(--ink)]">Notifications</p><p className="text-xs text-[var(--muted)]">{unreadCount ? `${unreadCount} unread` : 'You are all caught up'}</p></div>
              {unreadCount > 0 && <button type="button" onClick={markAllRead} className="inline-flex items-center gap-1 text-xs font-bold text-[var(--primary)] hover:underline"><CheckCheck size={15} /> Mark all read</button>}
            </div>
            <div className="max-h-80 overflow-y-auto overscroll-contain">
              {notifications.length ? notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => markRead(notification)}
                  className={`block w-full border-b border-[var(--border)] px-4 py-3 text-left last:border-b-0 hover:bg-[var(--app-bg)] ${notification.readAt ? 'bg-white' : 'bg-emerald-50/60'}`}
                >
                  <span className="flex items-start justify-between gap-3"><span className="font-bold text-[var(--ink)]">{notification.title}</span>{!notification.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-[var(--primary)]" />}</span>
                  <span className="mt-1 block text-sm text-[var(--muted)]">{notification.message}</span>
                  <span className="mt-2 block text-xs text-[var(--muted)]">{notificationTime(notification.createdAt)}</span>
                </button>
              )) : <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">No notifications yet.</p>}
            </div>
            {browserPermission === 'default' && <button type="button" onClick={enableBrowserAlerts} className="w-full border-t border-[var(--border)] px-4 py-3 text-left text-xs font-bold text-[var(--primary)] hover:bg-[var(--app-bg)]">Enable browser alerts on this device</button>}
            {browserPermission === 'denied' && <p className="border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--muted)]">Browser alerts are blocked. Enable them in your browser settings.</p>}
          </div>
        )}
      </div>

      {toast && (
        <button type="button" onClick={() => markRead(toast)} className="fixed bottom-5 right-5 z-[60] w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-emerald-200 bg-white p-4 text-left shadow-xl transition hover:border-emerald-300" role="status">
          <span className="text-sm font-black text-[var(--ink)]">{toast.title}</span>
          <span className="mt-1 block text-sm text-[var(--muted)]">{toast.message}</span>
        </button>
      )}
    </>
  )
}
