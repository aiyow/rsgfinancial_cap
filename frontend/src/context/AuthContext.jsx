import { useEffect, useState, useSyncExternalStore } from 'react'
import { apiRequest } from '../services/api'
import { disableDevicePush } from '../services/devicePush'
import AuthContext from './auth-context'
import {
  clearResidentOffline, getOfflineState, offlineSavedAt,
  restoreOfflineSession, saveVerifiedResident, setOfflineMode, subscribeOffline,
} from '../services/residentOffline'

function readStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('condo_user'))
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('condo_token'))
  const [user, setUser] = useState(readStoredUser)
  const [initializing, setInitializing] = useState(() => Boolean(localStorage.getItem('condo_token')))
  const [dataVersion, setDataVersion] = useState(0)
  const offlineState = useSyncExternalStore(subscribeOffline, getOfflineState)

  function clearSession() {
    void clearResidentOffline()
    localStorage.removeItem('condo_token')
    localStorage.removeItem('condo_user')
    setToken(null)
    setUser(null)
  }

  useEffect(() => {
    if (!token) {
      return
    }

    let active = true
    let checking = false
    restoreOfflineSession(token)

    async function verify() {
      if (checking || !active) return
      checking = true
      try {
        const { user: currentUser } = await apiRequest('/api/auth/me', { token })
        if (!active) return
        const reconnecting = getOfflineState().offline
        await saveVerifiedResident(currentUser, token)
        if (!active) return
        setUser(currentUser)
        localStorage.setItem('condo_user', JSON.stringify(currentUser))
        setOfflineMode(false)
        if (reconnecting) setDataVersion(version => version + 1)
        if (currentUser.role === 'RESIDENT') void saveResidentPages(token)
      } catch (error) {
        if (!active) return
        const savedUser = restoreOfflineSession(token)
        if ((error.networkError || error.status >= 500) && savedUser) {
          setUser(savedUser)
          setOfflineMode(true, offlineSavedAt())
        } else if (error.status === 401 || error.status === 403 || !savedUser) clearSession()
      } finally {
        checking = false
        if (active) setInitializing(false)
      }
    }

    function offline() { setOfflineMode(true, offlineSavedAt()) }
    function checkOnReturn() { if (document.visibilityState === 'visible') void verify() }
    function expireOrRetry() {
      if (getOfflineState().offline && !restoreOfflineSession(token)) clearSession()
      else if (getOfflineState().offline && navigator.onLine) void verify()
    }
    function sessionChanged(event) {
      if (event.key === 'condo_token' && event.newValue !== token) window.location.reload()
    }
    function accessRejected() { if (active) clearSession() }
    const retry = window.setInterval(expireOrRetry, 30_000)
    window.addEventListener('offline', offline)
    window.addEventListener('online', verify)
    window.addEventListener('storage', sessionChanged)
    window.addEventListener('resident-session-invalid', accessRejected)
    document.addEventListener('visibilitychange', checkOnReturn)
    void verify()
    return () => {
      active = false
      clearInterval(retry)
      window.removeEventListener('offline', offline)
      window.removeEventListener('online', verify)
      window.removeEventListener('storage', sessionChanged)
      window.removeEventListener('resident-session-invalid', accessRejected)
      document.removeEventListener('visibilitychange', checkOnReturn)
    }
  }, [token])

  async function login(credentials) {
    const data = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: credentials,
    })
    localStorage.setItem('condo_token', data.token)
    localStorage.setItem('condo_user', JSON.stringify(data.user))
    await saveVerifiedResident(data.user, data.token)
    setOfflineMode(false)
    setToken(data.token)
    setUser(data.user)
    return data.user
  }

  function replaceToken(nextToken) {
    localStorage.setItem('condo_token', nextToken)
    setToken(nextToken)
  }

  function updateUser(nextUser) {
    localStorage.setItem('condo_user', JSON.stringify(nextUser))
    setUser(nextUser)
  }

  function logout() {
    clearSession()
    if (token) void disableDevicePush(token).catch(() => {})
  }

  return (
    <AuthContext.Provider value={{ user, token, initializing, login, replaceToken, updateUser, logout, dataVersion, offline: offlineState.offline }}>
      {children}
    </AuthContext.Provider>
  )
}

async function saveResidentPages(token) {
  const paths = ['/api/bills', '/api/payments', '/api/analytics/resident', '/api/prescriptive-recommendations/resident']
  const [bills] = await Promise.allSettled(paths.map(path => apiRequest(path, { token })))
  if (bills.status !== 'fulfilled' || localStorage.getItem('condo_token') !== token) return
  await Promise.allSettled((bills.value.bills || []).slice(0, 12).map(bill => apiRequest(`/api/bills/${bill.id}`, { token })))
}
