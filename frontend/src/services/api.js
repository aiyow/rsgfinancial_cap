import { isOfflineRead, isResidentOffline, readResidentResponse, residentRequestGeneration, saveResidentResponse, setOfflineMode } from './residentOffline'

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5000').replace(/\/$/, '')

export async function apiRequest(path, { token, body, ...options } = {}) {
  const read = (options.method || 'GET').toUpperCase() === 'GET'
  const generation = residentRequestGeneration(token)
  if (!read && (!navigator.onLine || isResidentOffline(token))) throw new Error('You’re offline. Connect to the internet to make changes.')
  if (read && isOfflineRead(path) && isResidentOffline(token)) {
    const saved = await readResidentResponse(token, path)
    if (saved !== null) return saved
    throw Object.assign(new Error('This information has not been saved for offline viewing. Connect to the internet to load it.'), { networkError: true })
  }
  const headers = new Headers(options.headers)
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData
  if (body !== undefined && !isFormData) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  let response
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      signal: options.signal || (read && (generation || path === '/api/auth/me') ? AbortSignal.timeout(10_000) : undefined),
      headers,
      body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
    })
  } catch {
    if (options.signal?.aborted) throw new Error('Request cancelled.')
    if (read && isOfflineRead(path)) {
      const saved = await readResidentResponse(token, path)
      if (saved !== null) return saved
    }
    if (isResidentOffline(token) || !navigator.onLine) setOfflineMode(true)
    const error = new Error(generation && isOfflineRead(path)
      ? 'This information has not been saved for offline viewing. Connect to the internet to load it.'
      : 'Cannot reach the server. Check your internet connection and try again.')
    error.networkError = true
    throw error
  }

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.message || 'The request failed.')
    error.data = data
    error.status = response.status
    if (error.status === 401 && token && localStorage.getItem('condo_token') === token) {
      window.dispatchEvent(new Event('resident-session-invalid'))
    }
    throw error
  }
  if (read && isOfflineRead(path)) await saveResidentResponse(token, path, data, generation)
  return data
}

export async function apiFile(path, { token, signal } = {}) {
  const headers = new Headers()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(`${API_URL}${path}`, { headers, signal })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    const error = new Error(data.message || 'The file could not be loaded.')
    error.data = data
    error.status = response.status
    throw error
  }
  return response.blob()
}
