import { apiRequest } from './api'

export function supportsDevicePush() {
  return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export async function disableDevicePush(token) {
  if (!supportsDevicePush()) return
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return

  // Stop alerts locally even when sign-out happens during a network failure.
  await Promise.all([
    apiRequest('/api/notifications/push/subscription', {
      method: 'DELETE', token, body: { endpoint: subscription.endpoint },
    }),
    subscription.unsubscribe(),
  ])
}
