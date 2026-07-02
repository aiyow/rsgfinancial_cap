import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import AuthLayout from '../components/AuthLayout'
import RoleSelector from '../components/RoleSelector'
import { Alert, Button, InputField } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { dashboardPathFor } from '../constants/roles'

export default function LoginPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { login } = useAuth()
  const [role, setRole] = useState(location.state?.role || 'UNIT_OWNER')
  const [email, setEmail] = useState(location.state?.email || '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      const user = await login({ email, password, role })
      navigate(dashboardPathFor(user.role), { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout eyebrow="Welcome back" title="Sign in to DuesFlow" subtitle="Choose your workspace and enter your account details.">
      <form onSubmit={handleSubmit} className="space-y-5">
        {location.state?.registered && <Alert type="success">Account created. You can sign in now.</Alert>}
        {error && <Alert>{error}</Alert>}
        <RoleSelector value={role} onChange={setRole} />
        <InputField label="Email address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
        <InputField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" autoComplete="current-password" required />
        <Button type="submit" loading={loading} className="w-full">Sign in securely</Button>
      </form>
      <p className="mt-7 text-center text-sm text-slate-500">New to DuesFlow? <Link to="/register" className="font-bold text-indigo-600 hover:text-indigo-700">Create an account</Link></p>
      <p className="mt-5 rounded-xl bg-amber-50 px-4 py-3 text-center text-xs leading-5 text-amber-800">Demo mode: all three roles can create accounts.</p>
    </AuthLayout>
  )
}
