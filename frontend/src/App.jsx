import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import { dashboardPathFor } from './constants/routes'
import useAuth from './hooks/useAuth'
import Login from './pages/Login'
import Register from './pages/Register'
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminUnitsPage from './pages/admin/AdminUnitsPage'
import AdminUnitsViewPage from './pages/admin/AdminUnitsViewPage'
import AdminUsersPage from './pages/admin/AdminUsersPage'
import AdminSoaPage from './pages/admin/AdminSoaPage'
import AdminSoaBatchPage from './pages/admin/AdminSoaBatchPage'
import AdminSoaBillPage from './pages/admin/AdminSoaBillPage'
import AdminPaymentsPage from './pages/admin/AdminPaymentsPage'
import AdminPaymentPage from './pages/admin/AdminPaymentPage'
import AdminAuditLogsPage from './pages/admin/AdminAuditLogsPage'
import CollectorDashboard from './pages/collector/CollectorDashboard'
import CollectorBillingPage from './pages/collector/CollectorBillingPage'
import CollectorHistoryImportPage from './pages/collector/CollectorHistoryImportPage'
import CollectorBillsPage from './pages/collector/CollectorBillsPage'
import CollectorBillPage from './pages/collector/CollectorBillPage'
import CollectorUnitsPage from './pages/collector/CollectorUnitsPage'
import CollectorPaymentsPage from './pages/collector/CollectorPaymentsPage'
import CollectorSoaTemplatePage from './pages/collector/CollectorSoaTemplatePage'
import ResidentDashboard from './pages/resident/ResidentDashboard'
import ResidentBillsPage from './pages/resident/ResidentBillsPage'
import ResidentBillPage from './pages/resident/ResidentBillPage'
import ResidentPaymentsPage from './pages/resident/ResidentPaymentsPage'
import AnalyticsPage from './pages/shared/AnalyticsPage'
import ProfilePage from './pages/shared/ProfilePage'
import SettingsPage from './pages/shared/SettingsPage'

const authenticatedRoles = ['ADMIN', 'COLLECTOR', 'RESIDENT']

function HomeRedirect() {
  const { user, initializing } = useAuth()
  if (initializing) return <div className="min-h-screen bg-slate-100" />
  return <Navigate to={user ? dashboardPathFor(user.role) : '/login'} replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/profile" element={<ProtectedRoute allowedRoles={authenticatedRoles}><ProfilePage /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute allowedRoles={authenticatedRoles}><SettingsPage /></ProtectedRoute>} />
      <Route path="/admin" element={<ProtectedRoute allowedRole="ADMIN"><AdminDashboard /></ProtectedRoute>} />
      <Route path="/admin/users" element={<ProtectedRoute allowedRole="ADMIN"><AdminUsersPage /></ProtectedRoute>} />
      <Route path="/admin/units" element={<ProtectedRoute allowedRole="ADMIN"><AdminUnitsViewPage /></ProtectedRoute>} />
      <Route path="/admin/units/manage" element={<ProtectedRoute allowedRole="ADMIN"><AdminUnitsPage /></ProtectedRoute>} />
      <Route path="/admin/assignments" element={<ProtectedRoute allowedRole="ADMIN"><Navigate to="/admin/units/manage" replace /></ProtectedRoute>} />
      <Route path="/admin/soa" element={<ProtectedRoute allowedRole="ADMIN"><AdminSoaPage /></ProtectedRoute>} />
      <Route path="/admin/soa/batches/:periodId" element={<ProtectedRoute allowedRole="ADMIN"><AdminSoaBatchPage /></ProtectedRoute>} />
      <Route path="/admin/soa/bills/:id" element={<ProtectedRoute allowedRole="ADMIN"><AdminSoaBillPage /></ProtectedRoute>} />
      <Route path="/admin/payments" element={<ProtectedRoute allowedRole="ADMIN"><AdminPaymentsPage /></ProtectedRoute>} />
      <Route path="/admin/payments/:id" element={<ProtectedRoute allowedRole="ADMIN"><AdminPaymentPage /></ProtectedRoute>} />
      <Route path="/admin/audit-logs" element={<ProtectedRoute allowedRole="ADMIN"><AdminAuditLogsPage /></ProtectedRoute>} />
      <Route path="/admin/analytics" element={<ProtectedRoute allowedRole="ADMIN"><AnalyticsPage /></ProtectedRoute>} />
      <Route path="/collector" element={<ProtectedRoute allowedRole="COLLECTOR"><CollectorDashboard /></ProtectedRoute>} />
      <Route path="/collector/billing" element={<ProtectedRoute allowedRole="COLLECTOR"><CollectorBillingPage /></ProtectedRoute>} />
      <Route path="/collector/soa-template" element={<ProtectedRoute allowedRole="COLLECTOR"><CollectorSoaTemplatePage /></ProtectedRoute>} />
      <Route path="/collector/history-import" element={<ProtectedRoute allowedRole="COLLECTOR"><CollectorHistoryImportPage /></ProtectedRoute>} />
      <Route path="/collector/bills" element={<ProtectedRoute allowedRole="COLLECTOR"><CollectorBillsPage /></ProtectedRoute>} />
      <Route path="/collector/bills/:id" element={<ProtectedRoute allowedRole="COLLECTOR"><CollectorBillPage /></ProtectedRoute>} />
      <Route path="/collector/units" element={<ProtectedRoute allowedRole="COLLECTOR"><CollectorUnitsPage /></ProtectedRoute>} />
      <Route path="/collector/payments" element={<ProtectedRoute allowedRole="COLLECTOR"><CollectorPaymentsPage /></ProtectedRoute>} />
      <Route path="/collector/analytics" element={<ProtectedRoute allowedRole="COLLECTOR"><AnalyticsPage /></ProtectedRoute>} />
      <Route path="/resident" element={<ProtectedRoute allowedRole="RESIDENT"><ResidentDashboard /></ProtectedRoute>} />
      <Route path="/resident/bills" element={<ProtectedRoute allowedRole="RESIDENT"><ResidentBillsPage /></ProtectedRoute>} />
      <Route path="/resident/bills/:id" element={<ProtectedRoute allowedRole="RESIDENT"><ResidentBillPage /></ProtectedRoute>} />
      <Route path="/resident/payments" element={<ProtectedRoute allowedRole="RESIDENT"><ResidentPaymentsPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
