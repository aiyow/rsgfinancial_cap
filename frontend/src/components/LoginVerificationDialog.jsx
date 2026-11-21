import { useEffect, useRef, useState } from 'react'
import { ShieldCheck, X } from 'lucide-react'
import { apiRequest } from '../services/api'
import './LoginVerificationDialog.css'

export default function LoginVerificationDialog({ email, challenge, onVerify, onDismiss }) {
  const dialog = useRef(null)
  const codeInput = useRef(null)
  const [otp, setOtp] = useState('')
  const [trustDevice, setTrustDevice] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [restart, setRestart] = useState(false)
  const [now, setNow] = useState(Date.now)
  const [resendAt, setResendAt] = useState(() => Date.now() + challenge.retryAfterSeconds * 1000)

  useEffect(() => {
    const element = dialog.current
    element.showModal()
    codeInput.current?.focus()
    return () => element.close()
  }, [])

  useEffect(() => {
    if (now >= resendAt || restart) return
    const timer = window.setTimeout(() => setNow(Date.now()), 1000)
    return () => window.clearTimeout(timer)
  }, [now, resendAt, restart])

  const canTrustDevice = Boolean(globalThis.crypto?.subtle && globalThis.indexedDB)
  const resendSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000))

  function startResendCountdown(seconds) {
    const currentTime = Date.now()
    setNow(currentTime)
    setResendAt(currentTime + seconds * 1000)
  }

  function handleError(requestError) {
    setError(requestError.message)
    if (['LOGIN_CHALLENGE_EXPIRED', 'LOGIN_CODE_ATTEMPTS_EXCEEDED'].includes(requestError.data?.code)) setRestart(true)
    if (requestError.data?.retryAfterSeconds) startResendCountdown(requestError.data.retryAfterSeconds)
  }

  async function verify(event) {
    event.preventDefault()
    if (busy || restart || otp.length !== 6) return
    setBusy('verify')
    setError('')
    setNotice('')
    try {
      await onVerify(otp, trustDevice)
    } catch (requestError) {
      handleError(requestError)
    } finally {
      setBusy('')
    }
  }

  async function resend() {
    if (busy || restart || resendSeconds) return
    setBusy('resend')
    setError('')
    setNotice('')
    try {
      const result = await apiRequest('/api/auth/login/resend', {
        method: 'POST', body: { challengeId: challenge.challengeId },
      })
      setOtp('')
      setNotice(result.message)
      startResendCountdown(result.retryAfterSeconds)
    } catch (requestError) {
      handleError(requestError)
    } finally {
      setBusy('')
    }
  }

  function cancel(event) {
    event.preventDefault()
    if (!busy) onDismiss()
  }

  return (
    <dialog ref={dialog} onCancel={cancel} className="login-verification-dialog"
      aria-labelledby="login-verification-title" aria-describedby="login-verification-description">
      <header className="relative border-b border-emerald-950/10 px-14 py-4 text-center">
        <h2 id="login-verification-title" className="text-lg font-black tracking-tight text-slate-900">2-Step Verification</h2>
        <button type="button" onClick={onDismiss} disabled={Boolean(busy)} aria-label="Close verification"
          className="absolute right-2 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-lg text-slate-500 hover:bg-emerald-50 hover:text-emerald-950 disabled:opacity-50">
          <X size={21} aria-hidden="true" />
        </button>
      </header>
      <form onSubmit={verify} className="flex flex-col gap-4 px-5 pb-6 pt-5 sm:px-8 sm:pb-7">
        <div className="login-verification-shield mx-auto grid size-16 place-items-center rounded-2xl border border-emerald-100 bg-emerald-50 text-emerald-800">
          <ShieldCheck size={34} strokeWidth={1.7} aria-hidden="true" />
        </div>
        <p id="login-verification-description" className="text-center text-sm leading-6 text-slate-600">
          Enter the 6-digit code sent to <strong className="wrap-anywhere text-slate-900">{email}</strong>.
        </p>
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
        {notice && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</p>}
        {restart ? (
          <button type="button" onClick={onDismiss} className="login-submit">Back to sign in</button>
        ) : <>
          <label htmlFor="sign-in-otp" className="flex flex-col gap-1.5 text-sm font-bold text-slate-800">
            Verification code
            <input ref={codeInput} id="sign-in-otp" type="text" inputMode="numeric" autoComplete="one-time-code"
              pattern="[0-9]{6}" maxLength={6} placeholder="Enter 6-digit code" required disabled={Boolean(busy)}
              value={otp} onChange={event => setOtp(event.target.value.replace(/\D/g, ''))}
              className="h-12 w-full rounded-lg border border-slate-300 px-3 text-base font-medium outline-none placeholder:text-sm focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:opacity-60" />
          </label>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-emerald-50/70 px-3 py-3 text-sm text-slate-700">
            <input type="checkbox" checked={trustDevice} disabled={Boolean(busy) || !canTrustDevice} onChange={event => setTrustDevice(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-emerald-700" />
            <span><strong>Trust this device for 15 days</strong><span className="mt-0.5 block text-xs text-slate-600">{canTrustDevice ? 'Choose this only on a device you use privately.' : 'Device trust requires a secure connection and browser storage.'}</span></span>
          </label>
          <button type="submit" disabled={Boolean(busy) || otp.length !== 6} aria-busy={busy === 'verify'} className="login-submit">
            {busy === 'verify' ? 'Verifying…' : 'Verify and sign in'}
          </button>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <p className="text-slate-600">You have 10 minutes to verify.</p>
            <button type="button" disabled={Boolean(busy) || resendSeconds > 0} onClick={resend}
              className="min-h-8 rounded px-1 font-bold text-emerald-800 hover:underline disabled:cursor-not-allowed disabled:text-slate-500 disabled:no-underline">
              {busy === 'resend' ? 'Sending…' : resendSeconds ? `Resend in ${resendSeconds}s` : 'Resend code'}
            </button>
          </div>
        </>}
      </form>
    </dialog>
  )
}
