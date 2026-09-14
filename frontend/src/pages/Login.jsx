import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, LayoutDashboard, LockKeyhole, Mail, ShieldCheck } from 'lucide-react'
import BrandMark from '../components/BrandMark'
import { dashboardPathFor } from '../constants/routes'
import { apiRequest } from '../services/api'
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
  const [unverifiedEmail, setUnverifiedEmail] = useState('')
  const [resendBusy, setResendBusy] = useState(false)
  const [resendMessage, setResendMessage] = useState('')

  if (user) return <Navigate to={dashboardPathFor(user.role)} replace />

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function submit(event) {
    event.preventDefault()
    setError('')
    setUnverifiedEmail('')
    setResendMessage('')
    setLoading(true)
    try {
      const loggedInUser = await login(form)
      saveRememberedEmail(form.email, rememberEmail)
      navigate(dashboardPathFor(loggedInUser.role), { replace: true })
    } catch (requestError) {
      setError(requestError.message)
      if (requestError.data?.code === 'EMAIL_VERIFICATION_REQUIRED') setUnverifiedEmail(requestError.data.email || form.email)
    } finally {
      setLoading(false)
    }
  }

  async function resendVerification() {
    setResendBusy(true)
    setResendMessage('')
    try {
      const result = await apiRequest('/api/auth/resend-verification', { method: 'POST', body: { email: unverifiedEmail } })
      setResendMessage(result.message)
    } catch (requestError) {
      const retryAfter = requestError.data?.retryAfterSeconds
      setResendMessage(retryAfter ? `${requestError.message} Try again in ${Math.ceil(retryAfter / 60)} minute(s).` : requestError.message)
    } finally {
      setResendBusy(false)
    }
  }

  return (
    <main className="login-shell min-h-screen lg:grid lg:grid-cols-[minmax(420px,0.95fr)_minmax(560px,1.05fr)]">
      <section className="login-brand-panel relative flex min-h-[430px] flex-col justify-between overflow-hidden px-7 py-8 text-white sm:px-12 sm:py-10 lg:min-h-screen lg:px-[8%] lg:py-12">
        <div className="relative z-10 flex items-center gap-4"><BrandMark size="lg" /><div><h1 className="text-xl font-black tracking-tight">The ResiDens</h1><p className="text-xs font-medium uppercase tracking-[0.18em] text-emerald-100/75">Financial platform</p></div></div>
        <div className="relative z-10 max-w-xl py-12 lg:py-0"><p className="mb-7 text-sm font-bold uppercase tracking-[0.2em] text-emerald-300">Condominium management</p><h2 className="max-w-lg text-4xl font-black leading-[1.08] tracking-tight sm:text-5xl">Financial management system for the ResiDens Condominium.</h2><p className="mt-8 max-w-lg text-base leading-7 text-emerald-50/75">Manage billing, collections, payment processing, reporting, and financial operations through one centralized platform.</p><div className="mt-10 grid max-w-xl grid-cols-3 gap-5 border-t border-white/15 pt-7"><BrandFeature icon={ShieldCheck} title="Secure" text="Protected financial records" /><BrandFeature icon={LayoutDashboard} title="Centralized" text="One platform for operations" /><BrandFeature icon={ArrowRight} title="Efficient" text="Faster financial workflows" /></div></div>
        <p className="relative z-10 text-xs text-emerald-100/60">© 2026 The ResiDens. All rights reserved.</p>
      </section>

      <section className="flex min-h-screen items-center justify-center bg-[#f7faf8] px-6 py-12 sm:px-12 lg:px-[9%]"><div className="w-full max-w-xl"><div className="mb-8"><h2 className="text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">Sign in to your portal</h2><p className="mt-2 text-base text-slate-500">Enter your credentials to continue.</p></div>
        <div className="login-card"><form onSubmit={submit} className="space-y-5">{error && <p className="rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</p>}{unverifiedEmail && <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-sm text-amber-800"><p>Verify <span className="font-bold">{unverifiedEmail}</span> before signing in.</p><button type="button" disabled={resendBusy} onClick={resendVerification} className="mt-2 font-bold text-indigo-700 underline disabled:opacity-60">{resendBusy ? 'Sending verification email...' : 'Resend verification email'}</button>{resendMessage && <p className="mt-2 text-xs text-slate-600">{resendMessage}</p>}</div>}
          <label className="block text-sm font-bold text-slate-800">Email address<div className="input-with-icon"><Mail size={19} /><input required type="email" autoComplete="username" placeholder="you@example.com" value={form.email} onChange={(e) => update('email', e.target.value)} /></div></label>
          <label className="block text-sm font-bold text-slate-800">Password<div className="input-with-icon"><LockKeyhole size={19} /><input required type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" value={form.password} onChange={(e) => update('password', e.target.value)} /><button type="button" onClick={() => setShowPassword(!showPassword)} className="password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button></div></label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-500"><input type="checkbox" checked={rememberEmail} onChange={(event) => setRememberEmail(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-[var(--primary)] focus:ring-[var(--primary)]" />Remember email</label><button disabled={loading} className="login-submit">{loading ? 'Signing in...' : 'Sign in'}<ArrowRight size={20} /></button>
        </form></div><p className="mt-7 text-center text-sm text-slate-500">Don't have an account? <Link to="/register" className="font-bold text-[var(--primary)] hover:underline">Create an account</Link></p></div></section>
    </main>
  )
}

function BrandFeature({ icon: Icon, title, text }) { return <div className="brand-feature"><Icon size={17} /><p className="font-bold">{title}</p><span>{text}</span></div> }
