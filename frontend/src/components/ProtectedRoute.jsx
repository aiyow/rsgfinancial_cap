import { Navigate } from 'react-router-dom'
import { dashboardPathFor } from '../constants/routes'
import useAuth from '../hooks/useAuth'

export default function ProtectedRoute({ allowedRole, children }) {
  const { user, initializing } = useAuth()

  if (initializing) return <div className="min-h-screen bg-slate-100" />
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== allowedRole) return <Navigate to={dashboardPathFor(user.role)} replace />
  return children
}
