import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { apiRequest } from '../services/api'

export default function Register() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ fullName: '', email: '', password: '', role: 'RESIDENT' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function submit(event) {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      await apiRequest('/api/auth/register', { method: 'POST', body: form })
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
          <label className="block text-sm font-bold">Full name<input required value={form.fullName} onChange={(e) => update('fullName', e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
          <label className="block text-sm font-bold">Email<input required type="email" value={form.email} onChange={(e) => update('email', e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
          <label className="block text-sm font-bold">Password<input required minLength="8" type="password" value={form.password} onChange={(e) => update('password', e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
          <label className="block text-sm font-bold">Role<select value={form.role} onChange={(e) => update('role', e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal"><option value="ADMIN">Admin</option><option value="COLLECTOR">Collector</option><option value="RESIDENT">Resident</option></select></label>
          <button disabled={loading} className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{loading ? 'Creating...' : 'Create account'}</button>
        </form>
        <p className="mt-5 text-center text-sm"><Link to="/login" className="font-bold text-indigo-600">Back to login</Link></p>
      </section>
    </main>
  )
}
