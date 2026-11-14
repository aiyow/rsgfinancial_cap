const SESSION_KEY = 'residens_offline_session'
export const OFFLINE_ACCESS_MS = 7 * 24 * 60 * 60 * 1000
let sessionToken = null
let state = { offline: !navigator.onLine, savedAt: null }
const listeners = new Set()

export const subscribeOffline = (listener) => { listeners.add(listener); return () => listeners.delete(listener) }
export const getOfflineState = () => state

export function setOfflineMode(offline, savedAt = null) {
  const timestamp = offline ? Math.min(state.savedAt || Infinity, savedAt || Infinity) : Infinity
  state = { offline, savedAt: Number.isFinite(timestamp) ? timestamp : null }
  listeners.forEach(listener => listener())
}

function session() {
  try {
    const stored = JSON.parse(localStorage.getItem(SESSION_KEY))
    if (stored?.user?.role !== 'RESIDENT' || !Number.isFinite(stored.verifiedAt)
      || Date.now() < stored.verifiedAt || Date.now() - stored.verifiedAt >= OFFLINE_ACCESS_MS) return null
    return stored
  } catch {
    return null
  }
}

async function withStore(mode, operation) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('residens-resident-offline', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('responses')
    open.onerror = () => reject(open.error)
    open.onblocked = () => reject(new Error('Offline storage is busy.'))
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction('responses', mode)
      const request = operation(tx.objectStore('responses'))
      tx.oncomplete = () => { db.close(); resolve(request?.result) }
      tx.onerror = () => { db.close(); reject(tx.error) }
      tx.onabort = () => { db.close(); reject(tx.error) }
    }
  })
}

export function restoreOfflineSession(token) {
  sessionToken = token
  return session()?.user || null
}

export async function clearResidentOffline() {
  sessionToken = null
  localStorage.removeItem(SESSION_KEY)
  await withStore('readwrite', store => store.clear()).catch(() => {})
}

export async function saveVerifiedResident(user, token) {
  sessionToken = null
  localStorage.removeItem(SESSION_KEY)
  await withStore('readwrite', store => store.clear()).catch(() => {})
  if (user.role !== 'RESIDENT' || localStorage.getItem('condo_token') !== token) return
  const verifiedAt = Date.now()
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      user, verifiedAt, generation: crypto.randomUUID(), lastSavedAt: null,
    }))
    sessionToken = token
  } catch {
    // Online access continues if this browser cannot save an offline session.
  }
}

function scope(token) {
  if (!token || token !== sessionToken || localStorage.getItem('condo_token') !== token) return null
  return session()
}

export function isResidentOffline(token) {
  return Boolean(scope(token)) && (state.offline || !navigator.onLine)
}

export function residentRequestGeneration(token) {
  return scope(token)?.generation
}

export function offlineSavedAt() {
  return session()?.lastSavedAt || session()?.verifiedAt
}

export function isOfflineRead(path) {
  return /^\/api\/bills(?:\/\d+)?$/.test(path)
    || path === '/api/analytics/resident'
    || path === '/api/prescriptive-recommendations/resident'
    || /^\/api\/payments(?:\?status=(?:PENDING|APPROVED|REJECTED))?$/.test(path)
    || /^\/api\/notifications(?:\?[a-zA-Z0-9=&]+)?$/.test(path)
}

export async function saveResidentResponse(token, path, data, generation) {
  const current = scope(token)
  if (!current || current.generation !== generation || !isOfflineRead(path)) return
  const savedAt = Date.now()
  const key = current.generation + ':' + path
  try {
    await withStore('readwrite', store => store.put({ data, savedAt }, key))
    if (scope(token)?.generation !== current.generation) {
      await withStore('readwrite', store => store.delete(key))
      return
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify({ ...current, lastSavedAt: savedAt }))
  } catch {
    // Resident pages remain usable online when device storage is unavailable.
  }
}

export async function readResidentResponse(token, path) {
  const current = scope(token)
  if (!current || !isOfflineRead(path)) return null
  try {
    let result = await withStore('readonly', store => store.get(current.generation + ':' + path))
    if (!result && path.startsWith('/api/payments?status=')) {
      const all = await withStore('readonly', store => store.get(current.generation + ':/api/payments'))
      if (all) result = { ...all, data: { ...all.data, payments: all.data.payments.filter(payment => payment.reviewStatus === path.split('=')[1]) } }
    }
    if (scope(token)?.generation !== current.generation || !result || Date.now() - result.savedAt >= OFFLINE_ACCESS_MS) return null
    setOfflineMode(true, result.savedAt)
    return result.data
  } catch {
    return null
  }
}
