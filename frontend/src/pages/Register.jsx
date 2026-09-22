import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff } from 'lucide-react'
import BrandMark from '../components/BrandMark'
import { apiRequest } from '../services/api'

function fullName({ firstName, middleInitial, lastName }) {
  return [firstName, middleInitial, lastName].map((value) => value.trim()).filter(Boolean).join(' ')
}

export default function Register() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ firstName: '', middleInitial: '', lastName: '', email: '', password: '', confirmPassword: '', role: 'RESIDENT' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function submit(event) {
    event.preventDefault()
    setError('')
    if (form.password !== form.confirmPassword) {
      setError('Password and confirmation do not match.')
      return
    }
    setLoading(true)
    try {
      await apiRequest('/api/auth/register', { method: 'POST', body: { email: form.email, password: form.password, role: form.role, fullName: fullName(form) } })
      navigate(`/verify-email?email=${encodeURIComponent(form.email.trim())}`, { replace: true })
    } catch (requestError) {
      if (requestError.data?.code === 'EMAIL_DELIVERY_UNAVAILABLE') {
        navigate(`/verify-email?email=${encodeURIComponent(form.email.trim())}&delivery=unavailable`, { replace: true })
      } else {
        setError(requestError.message)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-green-shell min-h-screen px-5 py-8 sm:px-8 sm:py-12">
      <section className="auth-form-card mx-auto w-full max-w-lg rounded-2xl border border-white/70 bg-white p-6 shadow-xl sm:p-9">
        <div className="flex items-center gap-4"><BrandMark size="lg" /><div><h1 className="font-black text-slate-900">RSG Condo</h1><p className="text-xs font-medium uppercase tracking-[0.15em] text-slate-500">Financial platform</p></div></div>
        <div className="mt-8"><p className="text-sm font-bold uppercase tracking-[0.16em] text-[var(--primary)]">Get started</p><h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">Create your account</h2><p className="mt-2 text-sm leading-6 text-slate-500">Set up your access to the RSG Condo management platform.</p></div>
        <p className="mt-5 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">Development only: all roles are available.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-bold">First name<input required value={form.firstName} onChange={(event) => update('firstName', event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
            <label className="block text-sm font-bold">Last name<input required value={form.lastName} onChange={(event) => update('lastName', event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
          </div>
          <label className="block text-sm font-bold">MI <span className="font-normal text-slate-500">(optional)</span><input maxLength="20" value={form.middleInitial} onChange={(event) => update('middleInitial', event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
          <label className="block text-sm font-bold">Email<input required type="email" value={form.email} onChange={(event) => update('email', event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
          <PasswordInput label="Password" visible={showPassword} onToggle={() => setShowPassword((current) => !current)} value={form.password} onChange={(event) => update('password', event.target.value)} />
          <PasswordInput label="Confirm password" visible={showConfirmation} onToggle={() => setShowConfirmation((current) => !current)} value={form.confirmPassword} onChange={(event) => update('confirmPassword', event.target.value)} />
          <label className="block text-sm font-bold">Role<select value={form.role} onChange={(event) => update('role', event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal"><option value="ADMIN">Admin</option><option value="COLLECTOR">Billing Associate</option><option value="RESIDENT">Resident</option></select></label>
          <button disabled={loading} className="login-submit">{loading ? 'Creating...' : 'Create account'}<ArrowRight size={19} /></button>
        </form>
        <p className="mt-6 text-center text-sm text-slate-500">Already have an account? <Link to="/login" className="font-bold text-[var(--primary)] hover:underline">Back to sign in</Link></p>
      </section>
    </main>
  )
}

function PasswordInput({ label, visible, onChange, onToggle, value }) {
  return <label className="block text-sm font-bold">{label}<div className="relative mt-1.5"><input required minLength="8" type={visible ? 'text' : 'password'} value={value} onChange={onChange} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 pr-11 font-normal" /><button type="button" onClick={onToggle} aria-label={visible ? 'Hide password' : 'Show password'} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-500">{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
}
