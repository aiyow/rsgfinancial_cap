self.addEventListener('push', (event) => {
  let id
  try {
    const payload = event.data?.json()
    if (/^\d+$/.test(payload?.id)) id = payload.id
  } catch {
    // Even without a usable payload, the push represents a new app notification.
  }
  event.waitUntil(self.registration.showNotification('ResiDens', {
    body: 'You have a new notification. Open ResiDens to see it.',
    icon: '/icons/pwa-192.png',
    ...(id && { tag: `residens-${id}` }),
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil((async () => {
    const url = new URL('/notifications', self.location.origin).href
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows.find((client) => client.url === url)
    if (existing) await existing.focus()
    else await self.clients.openWindow(url)
  })())
})
