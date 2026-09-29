import { useState } from 'react'
import { CheckCircle2, Eye, EyeOff, KeyRound } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import BrandMark from '../components/BrandMark'
import { apiRequest } from '../services/api'

function PasswordInput({ label, value, onChange, visible, onToggle, autoComplete }) {
  return <label className="block text-sm font-bold">{label}<div className="relative mt-1.5"><input required minLength="8" type={visible ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={onChange} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 pr-11 font-normal" /><button type="button" onClick={onToggle} aria-label={visible ? 'Hide password' : 'Show password'} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-500">{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
}

export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(token ? '' : 'This password-reset link is missing or invalid.')
  const [complete, setComplete] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError('')
    if (!token) {
      setError('This password-reset link is missing or invalid.')
      return
    }
    if (password !== confirmation) {
      setError('Password and confirmation do not match.')
      return
    }
    setLoading(true)
    try {
      await apiRequest('/api/auth/reset-password', { method: 'POST', body: { token, password } })
      setComplete(true)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  return <main className="auth-green-shell min-h-screen px-5 py-8 sm:px-8 sm:py-12"><section className="auth-form-card mx-auto w-full max-w-md rounded-2xl border border-white/70 bg-white p-6 shadow-xl sm:p-9"><div className="flex items-center gap-4"><BrandMark size="lg" /><div><h1 className="font-black text-slate-900">The ResiDens</h1><p className="text-xs font-medium capitalize tracking-[0.15em] text-slate-500">Financial platform</p></div></div><div className="mt-8"><p className="text-sm font-bold capitalize tracking-[0.16em] text-[var(--primary)]">Account recovery</p><h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">Create a new password</h2><p className="mt-2 text-sm leading-6 text-slate-500">Use at least eight characters. Your other signed-in sessions will be signed out.</p></div>{complete ? <div className="mt-6 rounded-xl border border-emerald-100 bg-emerald-50 p-4"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 shrink-0 text-emerald-700" size={20} /><div><p className="font-bold text-emerald-950">Password changed</p><p className="mt-1 text-sm leading-6 text-emerald-900">You can now sign in with your new password.</p></div></div><Link to="/login" className="login-submit mt-4 inline-flex items-center justify-center">Go to sign in</Link></div> : <form onSubmit={submit} className="mt-6 space-y-4">{error && <p className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</p>}<PasswordInput label="New password" value={password} onChange={(event) => setPassword(event.target.value)} visible={showPassword} onToggle={() => setShowPassword((current) => !current)} autoComplete="new-password" /><PasswordInput label="Confirm new password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} visible={showConfirmation} onToggle={() => setShowConfirmation((current) => !current)} autoComplete="new-password" /><button disabled={loading || !token} className="login-submit inline-flex items-center justify-center gap-2"><KeyRound size={17} />{loading ? 'Changing password...' : 'Change password'}</button></form>}<Link to="/forgot-password" className="mt-6 inline-flex text-sm font-bold text-[var(--primary)] hover:underline">Request a new reset link</Link></section></main>
}
