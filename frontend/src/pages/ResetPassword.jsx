import { useEffect, useState } from 'react'
import { ArrowLeft, CheckCircle2, Eye, EyeOff, RotateCw } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import BrandMark from '../components/BrandMark'
import OtpInput from '../components/OtpInput'
import { apiRequest } from '../services/api'
import useAuth from '../hooks/useAuth'
import { clearPasswordRecovery, readPasswordRecovery, savePasswordRecovery } from '../utils/passwordRecovery'

function PasswordInput({ label, value, onChange, visible, onToggle }) {
  return <label className="block text-sm font-bold">{label}<div className="relative mt-1.5"><input required minLength="8" type={visible ? 'text' : 'password'} autoComplete="new-password" value={value} onChange={onChange} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 pr-11 font-normal" /><button type="button" onClick={onToggle} aria-label={visible ? 'Hide password' : 'Show password'} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-500">{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
}

export default function ResetPassword() {
  const location = useLocation()
  const navigate = useNavigate()
  const { logout } = useAuth()
  const [recovery, setRecovery] = useState(() => location.state?.challengeId ? location.state : readPasswordRecovery())
  const [digits, setDigits] = useState(() => Array(6).fill(''))
  const [resetToken, setResetToken] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [complete, setComplete] = useState(false)
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const resendSeconds = Math.max(0, Math.ceil(((recovery?.resendAt || 0) - now) / 1000))

  async function resend() {
    if (!recovery || resending || loading || resendSeconds) return
    setError('')
    setNotice('')
    setResending(true)
    try {
      const result = await apiRequest('/api/auth/forgot-password', { method: 'POST', body: { email: recovery.email } })
      const nextRecovery = savePasswordRecovery(recovery.email, result)
      setRecovery(nextRecovery)
      navigate('/reset-password', { replace: true, state: nextRecovery })
      setDigits(Array(6).fill(''))
      setNotice('Check your email for the new code.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setResending(false)
    }
  }

  async function verify(event) {
    event.preventDefault()
    if (!recovery || loading || resending || digits.some((digit) => !digit)) return
    setError('')
    setNotice('')
    setLoading(true)
    try {
      const result = await apiRequest('/api/auth/verify-password-reset-otp', {
        method: 'POST', body: { email: recovery.email, challengeId: recovery.challengeId, otp: digits.join('') },
      })
      setResetToken(result.resetToken)
      setDigits(Array(6).fill(''))
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  async function changePassword(event) {
    event.preventDefault()
    if (!recovery || !resetToken || loading) return
    setError('')
    if (password !== confirmation) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      await apiRequest('/api/auth/reset-password', {
        method: 'POST', body: { email: recovery.email, resetToken, password },
      })
      clearPasswordRecovery()
      logout()
      setResetToken('')
      setPassword('')
      setConfirmation('')
      setComplete(true)
    } catch (requestError) {
      setError(requestError.message)
      if (requestError.data?.code === 'PASSWORD_RESET_VERIFICATION_EXPIRED') setResetToken('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-green-shell min-h-screen px-5 py-8 sm:px-8 sm:py-12">
      <section className="auth-form-card mx-auto w-full max-w-md rounded-2xl border border-white/70 bg-white p-6 shadow-xl sm:p-9">
        <div className="flex items-center gap-4"><BrandMark size="lg" /><div><h1 className="font-black text-slate-900">The ResiDens</h1><p className="text-xs font-medium capitalize tracking-[0.15em] text-slate-500">Financial platform</p></div></div>
        <h2 className="mt-8 text-2xl font-black tracking-tight text-slate-900">{complete ? 'Password changed' : resetToken ? 'Create a new password' : 'Verify your email'}</h2>
        {error && <p role="alert" className="mt-4 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {complete ? (
          <div className="mt-5" role="status">
            <div className="flex items-center gap-2 text-sm text-emerald-800"><CheckCircle2 size={20} />Sign in with your new password.</div>
            <Link to="/login" state={{ email: recovery.email, passwordReset: true }} className="login-submit mt-5 inline-flex items-center justify-center">Go to sign in</Link>
          </div>
        ) : !recovery ? (
          <div className="mt-3"><p className="text-sm text-slate-500">Request a code to reset your password.</p><Link to="/forgot-password" className="login-submit mt-5 inline-flex items-center justify-center">Send code</Link></div>
        ) : resetToken ? (
          <>
            <p className="mt-2 text-sm text-slate-500">Use at least 8 characters.</p>
            <form onSubmit={changePassword} className="mt-6 space-y-4">
              <PasswordInput label="New password" value={password} onChange={(event) => setPassword(event.target.value)} visible={showPassword} onToggle={() => setShowPassword((current) => !current)} />
              <PasswordInput label="Confirm password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} visible={showConfirmation} onToggle={() => setShowConfirmation((current) => !current)} />
              <button disabled={loading} aria-busy={loading} className="login-submit">{loading ? 'Saving...' : 'Save password'}</button>
            </form>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm leading-6 text-slate-500">Enter the code sent to <strong className="break-words text-slate-700">{recovery.email}</strong>.</p>
            <form onSubmit={verify} className="mt-6 space-y-4">
              <OtpInput digits={digits} onChange={setDigits} disabled={loading || resending} />
              <p className="text-xs text-slate-500">Code expires in 10 minutes.</p>
              <button disabled={loading || resending || digits.some((digit) => !digit)} aria-busy={loading} className="login-submit">{loading ? 'Verifying...' : 'Verify code'}</button>
            </form>
            {notice && <p role="status" className="mt-4 text-sm text-emerald-800">{notice}</p>}
            <div className="mt-5 grid grid-cols-1 gap-3 border-t border-slate-100 pt-5 text-sm sm:grid-cols-2">
              <Link to="/forgot-password" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2.5 font-bold text-emerald-800 transition hover:border-emerald-500 hover:bg-emerald-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"><ArrowLeft size={17} aria-hidden="true" />Change email</Link>
              <button type="button" disabled={Boolean(resendSeconds) || resending || loading} onClick={resend} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-white px-3 py-2.5 font-bold text-emerald-800 transition hover:border-emerald-500 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-500"><RotateCw size={16} aria-hidden="true" />{resending ? 'Sending...' : resendSeconds ? `Resend in ${resendSeconds}s` : 'Resend code'}</button>
            </div>
          </>
        )}
      </section>
    </main>
  )
}
