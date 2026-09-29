import { useState } from 'react'
import { ArrowLeft, Mail, Send } from 'lucide-react'
import { Link } from 'react-router-dom'
import BrandMark from '../components/BrandMark'
import { apiRequest } from '../services/api'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      await apiRequest('/api/auth/forgot-password', { method: 'POST', body: { email } })
      setSent(true)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  return <main className="auth-green-shell min-h-screen px-5 py-8 sm:px-8 sm:py-12"><section className="auth-form-card mx-auto w-full max-w-md rounded-2xl border border-white/70 bg-white p-6 shadow-xl sm:p-9"><div className="flex items-center gap-4"><BrandMark size="lg" /><div><h1 className="font-black text-slate-900">The ResiDens</h1><p className="text-xs font-medium capitalize tracking-[0.15em] text-slate-500">Financial platform</p></div></div><div className="mt-8"><p className="text-sm font-bold capitalize tracking-[0.16em] text-[var(--primary)]">Account recovery</p><h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">Forgot your password?</h2><p className="mt-2 text-sm leading-6 text-slate-500">Enter your email and we will send a secure link to reset your password.</p></div>{sent ? <div className="mt-6 rounded-xl border border-emerald-100 bg-emerald-50 p-4"><div className="flex items-start gap-3"><Mail className="mt-0.5 shrink-0 text-emerald-700" size={20} /><div><p className="font-bold text-emerald-950">Check your email</p><p className="mt-1 text-sm leading-6 text-emerald-900">If an eligible account matches that email, a password-reset link has been sent. The link expires in one hour.</p></div></div></div> : <form onSubmit={submit} className="mt-6 space-y-4">{error && <p className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</p>}<label className="block text-sm font-bold">Email address<div className="input-with-icon mt-1.5"><Mail size={19} /><input required type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} /></div></label><button disabled={loading} className="login-submit inline-flex items-center justify-center gap-2">{loading ? 'Sending link...' : <><Send size={17} />Send reset link</>}</button></form>}<Link to="/login" className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-[var(--primary)] hover:underline"><ArrowLeft size={16} />Back to sign in</Link></section></main>
}
