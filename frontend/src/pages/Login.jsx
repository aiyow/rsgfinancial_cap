import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import BrandMark from '../components/BrandMark'
import { dashboardPathFor } from '../constants/routes'
import useAuth from '../hooks/useAuth'

const rememberedEmailKey = 'condo_remembered_email'

function readRememberedEmail() {
  try {
    return localStorage.getItem(rememberedEmailKey) || ''
  } catch {
    return ''
  }
}

function saveRememberedEmail(email, shouldRemember) {
  try {
    if (shouldRemember) {
      localStorage.setItem(rememberedEmailKey, email.trim())
    } else {
      localStorage.removeItem(rememberedEmailKey)
    }
  } catch {
    // Private browsing or browser settings can block storage; signing in still works.
  }
}

export default function Login() {
  const navigate = useNavigate()
  const { user, login } = useAuth()
  const [form, setForm] = useState(() => ({ email: readRememberedEmail(), password: '' }))
  const [rememberEmail, setRememberEmail] = useState(() => Boolean(readRememberedEmail()))
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
      saveRememberedEmail(form.email, rememberEmail)
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
        <div className="flex items-center gap-3"><BrandMark size="lg" /><div><h1 className="font-black">RSG Condo Water Billing</h1><p className="text-xs text-slate-500">Management &amp; resident portal</p></div></div>

        <form onSubmit={submit} className="mt-8 space-y-4">
          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

          <label className="block text-sm font-bold text-slate-700">Email
            <input required type="email" autoComplete="username" value={form.email} onChange={(e) => update('email', e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" />
          </label>

          <label className="block text-sm font-bold text-slate-700">Password
            <div className="relative mt-1.5">
              <input required type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={form.password} onChange={(e) => update('password', e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 pr-11 font-normal" />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-indigo-600">
                {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
              </button>
            </div>
          </label>

          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-600">
            <input type="checkbox" checked={rememberEmail} onChange={(event) => setRememberEmail(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
            Remember email?
          </label>

          <button disabled={loading} className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{loading ? 'Signing in...' : 'Sign in'}</button>
        </form>

        <p className="mt-5 text-center text-sm text-slate-500">Testing? <Link to="/register" className="font-bold text-indigo-600">Create an account</Link></p>
      </section>
    </main>
  )
}
