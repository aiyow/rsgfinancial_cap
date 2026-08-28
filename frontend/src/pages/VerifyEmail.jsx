import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Mail, RefreshCw, XCircle } from 'lucide-react'
import BrandMark from '../components/BrandMark'
import { apiRequest } from '../services/api'

// React Strict Mode runs effects twice in development. Keep one request per
// token so the first successful verification cannot be overwritten by a
// second request that sees the one-time token as already used.
const verificationRequests = new Map()

function verifyToken(token) {
  if (!verificationRequests.has(token)) {
    verificationRequests.set(token, apiRequest(`/api/auth/verify-email?token=${encodeURIComponent(token)}`))
  }
  return verificationRequests.get(token)
}

export default function VerifyEmail() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const deliveryUnavailable = searchParams.get('delivery') === 'unavailable'
  const [email, setEmail] = useState(() => searchParams.get('email') || '')
  const [status, setStatus] = useState(token ? 'verifying' : 'waiting')
  const [message, setMessage] = useState(() => (
    deliveryUnavailable
      ? 'Your account was created, but email delivery is not configured yet. Ask an administrator to configure SMTP, then request a new link below.'
      : 'Check your inbox and open the verification link to activate your account.'
  ))
  const [resendBusy, setResendBusy] = useState(false)
  const [resendMessage, setResendMessage] = useState('')

  useEffect(() => {
    if (!token) return undefined
    let active = true
    verifyToken(token)
      .then((result) => {
        if (!active) return
        setStatus('verified')
        setMessage(result.message)
      })
      .catch((error) => {
        if (!active) return
        setStatus('error')
        setMessage(error.message)
      })
    return () => { active = false }
  }, [token])

  async function resend(event) {
    event.preventDefault()
    setResendMessage('')
    setResendBusy(true)
    try {
      const result = await apiRequest('/api/auth/resend-verification', { method: 'POST', body: { email } })
      setResendMessage(result.message)
    } catch (error) {
      const retryAfter = error.data?.retryAfterSeconds
      setResendMessage(retryAfter ? `${error.message} Try again in ${Math.ceil(retryAfter / 60)} minute(s).` : error.message)
    } finally {
      setResendBusy(false)
    }
  }

  const Icon = status === 'verified' ? CheckCircle2 : status === 'error' ? XCircle : Mail
  const iconTone = status === 'verified' ? 'text-emerald-600' : status === 'error' ? 'text-rose-600' : 'text-indigo-600'

  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 p-5">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="flex justify-center"><BrandMark size="lg" /></div>
        <Icon className={`mx-auto mt-6 ${iconTone}`} size={42} aria-hidden="true" />
        <h1 className="mt-4 text-xl font-black text-slate-900">
          {status === 'verifying' ? 'Verifying your email...' : status === 'verified' ? 'Email verified' : status === 'error' ? 'Verification link unavailable' : 'Verify your email'}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">{message}</p>

        {status !== 'verified' && (
          <form onSubmit={resend} className="mt-6 rounded-xl bg-slate-50 p-4 text-left">
            <label className="block text-sm font-bold text-slate-700">Email address
              <input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal" />
            </label>
            <button disabled={resendBusy} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-white px-4 py-2.5 text-sm font-bold text-indigo-700 disabled:cursor-not-allowed disabled:opacity-60">
              <RefreshCw size={16} className={resendBusy ? 'animate-spin' : ''} />{resendBusy ? 'Sending...' : 'Resend verification email'}
            </button>
            {resendMessage && <p className="mt-3 text-xs leading-5 text-slate-600">{resendMessage}</p>}
          </form>
        )}

        <Link to="/login" className="mt-6 inline-block text-sm font-bold text-indigo-600 hover:underline">Back to sign in</Link>
      </section>
    </main>
  )
}
