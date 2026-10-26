import { useState } from 'react'
import { ArrowLeft, Mail, Send } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import BrandMark from '../components/BrandMark'
import { apiRequest } from '../services/api'
import { clearPasswordRecovery, savePasswordRecovery } from '../utils/passwordRecovery'

export default function ForgotPassword() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    if (loading) return
    setError('')
    setLoading(true)
    clearPasswordRecovery()
    try {
      const result = await apiRequest('/api/auth/forgot-password', { method: 'POST', body: { email } })
      if (!result.challengeId) throw new Error('Unable to start password recovery. Please try again.')
      const recovery = savePasswordRecovery(email, result)
      navigate('/reset-password', { state: recovery })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-green-shell min-h-screen px-5 py-8 sm:px-8 sm:py-12">
      <section className="auth-form-card mx-auto w-full max-w-md rounded-2xl border border-white/70 bg-white p-6 shadow-xl sm:p-9">
        <div className="flex items-center gap-4"><BrandMark size="lg" /><div><h1 className="font-black text-slate-900">The ResiDens</h1><p className="text-xs font-medium capitalize tracking-[0.15em] text-slate-500">Financial platform</p></div></div>
        <div className="mt-8">
          <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">Forgot your password?</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">Enter your registered email address to receive a verification code.</p>
        </div>
        <form onSubmit={submit} className="mt-6 space-y-4">
          {error && <p id="forgot-password-error" role="alert" className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <label className="block text-sm font-bold">Email address<div className="input-with-icon mt-1.5"><Mail size={19} /><input required type="email" autoComplete="email" aria-describedby={error ? 'forgot-password-error' : undefined} placeholder="you@example.com" value={email} onChange={(event) => { setEmail(event.target.value); setError('') }} /></div></label>
          <button disabled={loading} aria-busy={loading} className="login-submit inline-flex items-center justify-center gap-2">{loading ? 'Sending code...' : <><Send size={17} />Send OTP code</>}</button>
        </form>
        <Link to="/login" className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-800 transition hover:border-emerald-500 hover:bg-emerald-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"><ArrowLeft size={17} aria-hidden="true" />Back to sign in</Link>
      </section>
    </main>
  )
}
