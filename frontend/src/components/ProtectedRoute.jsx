import { Navigate } from 'react-router-dom'
import { dashboardPathFor } from '../constants/routes'
import useAuth from '../hooks/useAuth'

export default function ProtectedRoute({ allowedRole, allowedRoles, children }) {
  const { user, initializing } = useAuth()

  if (initializing) return <div className="min-h-screen bg-slate-100" />
  if (!user) return <Navigate to="/login" replace />
  const roles = allowedRoles || (allowedRole ? [allowedRole] : [])
  if (roles.length > 0 && !roles.includes(user.role)) return <Navigate to={dashboardPathFor(user.role)} replace />
  return children
}
