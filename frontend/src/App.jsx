import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import DashboardPage from './pages/DashboardPage'
import { dashboardPathFor } from './constants/roles'

function HomeRedirect() {
  const { user, initializing } = useAuth()

  if (initializing) return <div className="min-h-screen bg-slate-50" />
  return <Navigate to={user ? dashboardPathFor(user.role) : '/login'} replace />
}

function PublicOnly({ children }) {
  const { user, initializing } = useAuth()

  if (initializing) return <div className="min-h-screen bg-slate-50" />
  return user ? <Navigate to={dashboardPathFor(user.role)} replace /> : children
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
      <Route path="/register" element={<PublicOnly><RegisterPage /></PublicOnly>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
