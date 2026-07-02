import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthLayout from '../components/AuthLayout'
import RoleSelector from '../components/RoleSelector'
import { Alert, Button, InputField } from '../components/ui'
import { useAuth } from '../context/AuthContext'

export default function RegisterPage() {
  const navigate = useNavigate()
  const { register } = useAuth()
  const [form, setForm] = useState({ fullName: '', email: '', password: '', confirmPassword: '', role: 'UNIT_OWNER' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    if (form.password.length < 8) return setError('Password must be at least 8 characters.')
    if (form.password !== form.confirmPassword) return setError('Passwords do not match.')

    setLoading(true)
    try {
      await register({ fullName: form.fullName, email: form.email, password: form.password, role: form.role })
      navigate('/login', { replace: true, state: { registered: true, email: form.email, role: form.role } })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout eyebrow="Create your account" title="Join your property workspace" subtitle="This demo allows registration for each supported portal role.">
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && <Alert>{error}</Alert>}
        <RoleSelector value={form.role} onChange={(value) => update('role', value)} compact />
        <InputField label="Full name" value={form.fullName} onChange={(e) => update('fullName', e.target.value)} placeholder="Your full name" autoComplete="name" maxLength="150" required />
        <InputField label="Email address" type="email" value={form.email} onChange={(e) => update('email', e.target.value)} placeholder="you@example.com" autoComplete="email" required />
        <div className="grid gap-5 sm:grid-cols-2">
          <InputField label="Password" type="password" value={form.password} onChange={(e) => update('password', e.target.value)} placeholder="8+ characters" autoComplete="new-password" required />
          <InputField label="Confirm password" type="password" value={form.confirmPassword} onChange={(e) => update('confirmPassword', e.target.value)} placeholder="Repeat password" autoComplete="new-password" required />
        </div>
        <Button type="submit" loading={loading} className="w-full">Create demo account</Button>
      </form>
      <p className="mt-7 text-center text-sm text-slate-500">Already registered? <Link to="/login" className="font-bold text-indigo-600 hover:text-indigo-700">Sign in</Link></p>
    </AuthLayout>
  )
}
