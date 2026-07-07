import { useEffect, useState } from 'react'
import { apiRequest } from '../services/api'
import AuthContext from './auth-context'

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

  function clearSession() {
    localStorage.removeItem('condo_token')
    localStorage.removeItem('condo_user')
    setToken(null)
    setUser(null)
  }

  useEffect(() => {
    if (!token) {
      return
    }

    apiRequest('/api/auth/me', { token })
      .then(({ user: currentUser }) => {
        setUser(currentUser)
        localStorage.setItem('condo_user', JSON.stringify(currentUser))
      })
      .catch(clearSession)
      .finally(() => setInitializing(false))
  }, [token])

  async function login(credentials) {
    const data = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: credentials,
    })
    localStorage.setItem('condo_token', data.token)
    localStorage.setItem('condo_user', JSON.stringify(data.user))
    setToken(data.token)
    setUser(data.user)
    return data.user
  }

  return (
    <AuthContext.Provider value={{ user, token, initializing, login, logout: clearSession }}>
      {children}
    </AuthContext.Provider>
  )
}
