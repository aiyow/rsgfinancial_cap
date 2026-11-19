import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, ReceiptText, ShieldCheck, TrendingUp } from 'lucide-react'
import BrandMark from '../components/BrandMark'
import PwaInstallPrompt from '../components/PwaInstallPrompt'
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
  const location = useLocation()
  const { user, login } = useAuth()
  const [form, setForm] = useState(() => ({ email: location.state?.email || readRememberedEmail(), password: '' }))
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
      if (requestError.data?.code === 'ACCOUNT_APPROVAL_REQUIRED') {
        navigate(`/pending-approval?email=${encodeURIComponent(requestError.data.email || form.email.trim())}`, { replace: true })
        return
      }
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-shell min-h-screen lg:grid lg:grid-cols-[minmax(420px,0.95fr)_minmax(560px,1.05fr)]">
      <section className="login-brand-panel relative flex min-h-[430px] flex-col overflow-hidden px-7 py-8 text-white sm:px-12 sm:py-10 lg:min-h-screen lg:px-[8%] lg:py-[clamp(1.75rem,5.4vh,3rem)]">
        <div className="relative z-10 flex items-center gap-4"><BrandMark size="lg" /><div><h1 className="text-xl font-black tracking-tight">The ResiDens</h1><p className="text-xs font-medium capitalize tracking-[0.18em] text-emerald-100/75">Financial platform</p></div></div>
        <div className="login-brand-content relative z-10 max-w-xl py-12 lg:mt-[clamp(2rem,7vh,4rem)] lg:py-0">
          <h2 className="login-hero-title text-4xl font-black leading-[1.08] tracking-tight sm:text-5xl lg:text-[clamp(2.125rem,3.2vw,3rem)]"><span className="lg:hidden">Your condo bills.<br />One simple portal.</span><span className="hidden lg:inline">Financial Management System for <span className="whitespace-nowrap">The ResiDens</span> Condominium.</span></h2>
          <p className="login-hero-description mt-5 max-w-lg text-base leading-6 text-emerald-50/75">
            <span className="lg:hidden">View bills, scan payment receipts, and see water forecasts.</span>
            <span className="hidden lg:inline">Manage condo billing, collections, payments, and financial reports in one place.</span>
          </p>
          <div className="mt-7 hidden grid-cols-3 gap-3 border-t border-white/15 pt-5 lg:grid xl:gap-4">
            <BrandFeature icon={TrendingUp} title="Water Forecasts" text="Estimates water use and bills" />
            <BrandFeature icon={ReceiptText} title="Receipt OCR" text="Reads payment details for review" />
            <BrandFeature icon={ShieldCheck} title="Access Control" text="Records by role and unit" />
          </div>
        </div>
        <p className="relative z-10 mt-auto hidden pt-6 text-xs text-emerald-100/60 lg:block">© 2026 The ResiDens. All rights reserved.</p>
      </section>

      <section id="sign-in" aria-labelledby="sign-in-heading" className="login-form-panel flex min-h-screen items-center justify-center bg-[#f7faf8] px-6 py-12 sm:px-12 lg:px-[9%]"><div className="w-full max-w-xl"><div className="login-form-heading mb-8"><h2 id="sign-in-heading" className="text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">Sign in to your portal</h2><p className="mt-2 text-base text-slate-500">Enter your credentials to continue.</p></div>
        <div className="login-card"><form onSubmit={submit} className="space-y-5">{location.state?.passwordReset && <p role="status" className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800">Password changed. Enter your new password to sign in.</p>}{error && <p className="rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <label className="block text-sm font-bold text-slate-800">Email address<div className="input-with-icon"><Mail size={19} /><input required type="email" autoComplete="username" placeholder="you@example.com" value={form.email} onChange={(e) => update('email', e.target.value)} /></div></label>
          <label className="block text-sm font-bold text-slate-800">Password<div className="input-with-icon"><LockKeyhole size={19} /><input required type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" value={form.password} onChange={(e) => update('password', e.target.value)} /><button type="button" onClick={() => setShowPassword(!showPassword)} className="password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button></div></label>
          <div className="-mt-2 flex justify-end"><Link to="/forgot-password" className="account-registration-link text-sm">Forgot password?</Link></div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-500"><input type="checkbox" checked={rememberEmail} onChange={(event) => setRememberEmail(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-[var(--primary)] focus:ring-[var(--primary)]" />Remember email</label><button disabled={loading} aria-busy={loading} className="login-submit">{loading && <span className="login-spinner" aria-hidden="true" />}{loading ? 'Signing in...' : 'Sign in'}</button>
        </form></div><Link to="/register" className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-white px-4 py-3 text-sm font-bold text-emerald-800 shadow-sm transition hover:border-emerald-500 hover:bg-emerald-50">Create an account <ArrowRight size={17} /></Link><div className="mt-2 text-center"><PwaInstallPrompt /></div></div></section>
    </main>
  )
}

function BrandFeature({ icon: Icon, title, text }) {
  return (
    <div className="brand-feature">
      <div className="flex items-center gap-2 font-bold"><Icon size={17} className="shrink-0" aria-hidden="true" /><p>{title}</p></div>
      <span>{text}</span>
    </div>
  )
}
