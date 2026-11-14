const SHELL_CACHE = 'residens-shell-OFFLINE_BUILD_VERSION'
const SHELL_FILES = /* OFFLINE_FILES */ []

self.addEventListener('install', event => {
  if (!SHELL_FILES.length) return
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_FILES)))
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter(key => key.startsWith('residens-shell-') && key !== SHELL_CACHE).map(key => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !SHELL_FILES.length) return
  const navigation = event.request.mode === 'navigate'
  if (!navigation && !SHELL_FILES.includes(url.pathname)) return
  if (navigation && !/^\/(?:$|login$|resident(?:\/|$)|profile$|settings$|notifications$)/.test(url.pathname)) return
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE)
    if (!navigation) {
      const saved = await cache.match(url.pathname)
      if (saved) return saved
    }
    try {
      return await fetch(event.request)
    } catch {
      return await cache.match(navigation ? '/index.html' : url.pathname)
        || new Response('Connect to the internet to load this page.', { status: 503 })
    }
  })())
})

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
