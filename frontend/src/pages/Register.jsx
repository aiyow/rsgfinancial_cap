import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, ShieldCheck } from 'lucide-react'
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
      navigate('/login', { replace: true })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 p-5">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-indigo-600 text-white"><ShieldCheck size={23} strokeWidth={2.2} /></span><div><h1 className="font-black">RSG Condo</h1><p className="text-xs text-slate-500">Create test account</p></div></div>
        <p className="mt-1 text-sm text-amber-700">Development only: all roles are available.</p>
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
          <label className="block text-sm font-bold">Role<select value={form.role} onChange={(event) => update('role', event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal"><option value="ADMIN">Admin</option><option value="COLLECTOR">Collector</option><option value="RESIDENT">Resident</option></select></label>
          <button disabled={loading} className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{loading ? 'Creating...' : 'Create account'}</button>
        </form>
        <p className="mt-5 text-center text-sm"><Link to="/login" className="font-bold text-indigo-600">Back to login</Link></p>
      </section>
    </main>
  )
}

function PasswordInput({ label, visible, onChange, onToggle, value }) {
  return <label className="block text-sm font-bold">{label}<div className="relative mt-1.5"><input required minLength="8" type={visible ? 'text' : 'password'} value={value} onChange={onChange} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 pr-11 font-normal" /><button type="button" onClick={onToggle} aria-label={visible ? 'Hide password' : 'Show password'} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-500">{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
}
