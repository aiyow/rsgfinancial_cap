import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { dashboardPathFor } from '../constants/routes'
import useAuth from '../hooks/useAuth'

export default function Login() {
  const navigate = useNavigate()
  const { user, login } = useAuth()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  if (user) return <Navigate to={dashboardPathFor(user.role)} replace />

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function submit(event) {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      const loggedInUser = await login(form)
      navigate(dashboardPathFor(loggedInUser.role), { replace: true })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 p-5">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-indigo-600 text-white"><ShieldCheck size={23} strokeWidth={2.2} /></span><div><h1 className="font-black">RSG Condo</h1><p className="text-xs text-slate-500">Sign in to continue</p></div></div>

        <form onSubmit={submit} className="mt-8 space-y-4">
          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

          <label className="block text-sm font-bold text-slate-700">Email
            <input required type="email" value={form.email} onChange={(e) => update('email', e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" />
          </label>

          <label className="block text-sm font-bold text-slate-700">Password
            <div className="relative mt-1.5">
              <input required type={showPassword ? 'text' : 'password'} value={form.password} onChange={(e) => update('password', e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 pr-11 font-normal" />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-indigo-600">
                {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
              </button>
            </div>
          </label>

          <button disabled={loading} className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{loading ? 'Signing in...' : 'Sign in'}</button>
        </form>

        <p className="mt-5 text-center text-sm text-slate-500">Testing? <Link to="/register" className="font-bold text-indigo-600">Create an account</Link></p>
      </section>
    </main>
  )
}
