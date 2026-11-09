import { useEffect, useState } from 'react'
import { Bell, BellOff } from 'lucide-react'
import { apiRequest } from '../services/api'
import { disableDevicePush, supportsDevicePush } from '../services/devicePush'

export default function PushNotificationSettings({ token }) {
  const [settings, setSettings] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const supported = supportsDevicePush()

  useEffect(() => {
    if (!supported) return
    let active = true
    async function loadSettings() {
      try {
        const previous = await navigator.serviceWorker.getRegistration()
        const subscription = await previous?.pushManager.getSubscription()
        const config = await apiRequest('/api/notifications/push/settings', {
          method: 'POST', token, body: { endpoint: subscription?.endpoint },
        })
        if (!active) return
        let registration = previous
        if (config.publicKey && !previous?.active) {
          await navigator.serviceWorker.register('/push-worker.js', { updateViaCache: 'none' })
          registration = await navigator.serviceWorker.ready
        }
        if (active) setSettings({ ...config, subscription, registration })
      } catch {
        if (active) setError('Push notifications are unavailable right now. Reopen the menu to try again.')
      }
    }
    void loadSettings()
    return () => { active = false }
  }, [supported, token])

  async function toggle() {
    setBusy(true)
    setError('')
    let subscription = settings.subscription
    try {
      if (settings.enabled) {
        await disableDevicePush(token)
        setSettings({ ...settings, enabled: false, subscription: null })
      } else {
        // Replace a browser subscription that the server no longer recognizes.
        if (subscription) {
          await subscription.unsubscribe()
          subscription = null
        }
        const key = window.atob(settings.publicKey.replace(/-/g, '+').replace(/_/g, '/'))
        subscription = await settings.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: Uint8Array.from(key, character => character.charCodeAt(0)),
        })
        await apiRequest('/api/notifications/push/subscription', {
          method: 'PUT', token, body: subscription.toJSON(),
        })
        setSettings({ ...settings, enabled: true, subscription })
      }
    } catch {
      setSettings({ ...settings, subscription })
      if (window.Notification.permission !== 'denied') {
        setError('Could not update push notifications. Reopen the menu to try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  let content
  if (!supported) content = 'Push alerts need a supported browser. On iPhone or iPad, open ResiDens from your Home Screen.'
  else if (!settings) content = error ? null : 'Checking push notifications…'
  else if (!settings.enabled && !settings.publicKey) content = 'Push notifications are unavailable right now.'
  else if (!settings.enabled && window.Notification.permission === 'denied') content = 'Push alerts are blocked. Allow notifications in your device or browser settings.'
  else {
    const Icon = settings.enabled ? BellOff : Bell
    content = <button
      type="button"
      disabled={busy}
      aria-busy={busy}
      onClick={toggle}
      className={`mx-auto flex min-h-8 w-fit items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:opacity-50 sm:min-h-11 sm:w-full sm:gap-2 sm:px-3 sm:py-2 sm:text-sm ${settings.enabled ? 'border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-100' : 'border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800'}`}
    >
      <Icon className="size-3.5 sm:size-4" aria-hidden="true" />
      {busy ? 'Updating…' : settings.enabled ? 'Disable Notification' : 'Enable Notification'}
    </button>
  }

  return <div className="border-b border-[var(--border)] bg-emerald-50/60 px-2.5 py-1 text-[11px] text-[var(--muted)] sm:px-4 sm:py-3 sm:text-xs">
    {content}
    {error && <p role="alert" className="text-rose-700">{error}</p>}
  </div>
}
