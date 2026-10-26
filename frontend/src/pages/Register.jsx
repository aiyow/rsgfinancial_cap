import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, Clock3, RefreshCw } from 'lucide-react'
import PasswordInput from '../components/PasswordInput'
import { passwordError } from '../utils/passwordPolicy'
import BrandMark from '../components/BrandMark'
import { apiRequest } from '../services/api'
import { readRegistrationRecovery, saveRegistrationRecovery, clearRegistrationRecovery } from '../utils/registrationRecovery'

const middleInitialPattern = /^[A-Za-z]{1,2}\.?$/
const middleInitialMessage = 'Use 1–2 letters, optionally followed by a period, such as J, JP, or JP.'

function invalidMiddleInitial(value) {
  return value !== '' && (!middleInitialPattern.test(value) || value !== value.trim())
}

export default function Register() {
  const navigate = useNavigate()
  const [savedChallenge] = useState(readRegistrationRecovery)
  const [form, setForm] = useState({ firstName: '', middleInitial: '', lastName: '', email: savedChallenge?.email || '', password: '', confirmPassword: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState(savedChallenge ? 'otp' : 'email')
  const [challenge, setChallenge] = useState(savedChallenge)
  const [otp, setOtp] = useState('')
  const [grant, setGrant] = useState(null)
  const [retryAt, setRetryAt] = useState(savedChallenge?.retryAt || 0)
  const [now, setNow] = useState(Date.now)
  const heading = useRef(null)
  const remaining = Math.max(0, Math.ceil((retryAt-now)/1000))
  const grantExpired = grant && new Date(grant.expiresAt).getTime() <= now
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  useEffect(() => { heading.current?.focus() }, [step])

  function changeEmail() {
    clearRegistrationRecovery()
    setStep('email'); setChallenge(null); setGrant(null); setOtp(''); setError(''); setRetryAt(0)
    setForm(current => ({ ...current, password:'', confirmPassword:'' }))
  }
  function requestError(error) {
    setError(error.message)
    if (error.data?.retryAfterSeconds) setRetryAt(Date.now()+error.data.retryAfterSeconds*1000)
  }
  async function sendCode(event) {
    event?.preventDefault()
    if (loading || remaining) return
    setError(''); setLoading(true)
    const email = form.email.trim().toLowerCase()
    try {
      const result = await apiRequest('/api/auth/register/send-otp', { method:'POST', body:{ email } })
      if (!result.challengeId) throw new Error('Unable to start email verification. Please try again.')
      setForm(current => ({ ...current, email }))
      const recovered = saveRegistrationRecovery(email,result)
      setChallenge(recovered); setGrant(null); setOtp('')
      setRetryAt(recovered.retryAt); setNow(Date.now()); setStep('otp')
    } catch (error) { requestError(error) }
    finally { setLoading(false) }
  }
  async function verifyCode(event) {
    event.preventDefault()
    if (loading || !challenge) return
    setError(''); setLoading(true)
    try {
      const result = await apiRequest('/api/auth/register/verify-otp', { method:'POST', body:{ email:challenge.email, challengeId:challenge.id, otp } })
      if (!result.registrationToken || !result.expiresAt) throw new Error('Unable to verify your email. Please try again.')
      clearRegistrationRecovery()
      setGrant(result); setOtp(''); setStep('details'); setNow(Date.now())
    } catch (error) { requestError(error) }
    finally { setLoading(false) }
  }

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function submit(event) {
    event.preventDefault()
    if (loading) return
    setError('')
    if (!grant || grantExpired) { setError('Email verification expired. Verify your email again.'); return }
    if (invalidMiddleInitial(form.middleInitial)) {
      setError(middleInitialMessage)
      return
    }
    const validationError = passwordError(form.password, form.confirmPassword)
    if (validationError) {
      setError(validationError)
      return
    }
    setLoading(true)
    try {
      const result = await apiRequest('/api/auth/register', { method: 'POST', body: { email: form.email, password: form.password, firstName: form.firstName, middleInitial: form.middleInitial, lastName: form.lastName, registrationToken: grant.registrationToken } })
      clearRegistrationRecovery()
      navigate(`/pending-approval?email=${encodeURIComponent(result.user?.email || form.email.trim())}`, { replace: true })
    } catch (error) {
      requestError(error)
      if (error.status === 403) setGrant(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-green-shell min-h-screen px-5 py-8 sm:px-8 sm:py-12">
      <section className="auth-form-card mx-auto w-full max-w-lg rounded-2xl border border-white/70 bg-white p-6 shadow-xl sm:p-9">
        <div className="flex items-center gap-4"><BrandMark size="lg" /><div><h1 className="font-black text-slate-900">The ResiDens</h1><p className="text-xs font-medium capitalize tracking-[0.15em] text-slate-500">Financial platform</p></div></div>
        <div className="mt-8"><p className="text-sm font-bold capitalize tracking-[0.16em] text-[var(--primary)]">Get started</p><h2 ref={heading} tabIndex={-1} className="mt-2 outline-none text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">{step === 'otp' ? 'Verify your email' : step === 'details' ? 'Complete your account' : 'Create your account'}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{step === 'email' ? 'Verify your email first. Your account will need Admin approval.' : step === 'otp' ? `Enter the six-digit code sent to ${challenge?.email}.` : 'Your email is verified. Add your name and password to continue.'}</p></div>
        <RegistrationProgress step={step} />
        {step !== 'details' && <form onSubmit={step === 'email' ? sendCode : verifyCode} className="mt-6 space-y-4">
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {step === 'email' ? <label className="block text-sm font-bold">Email address<input required type="email" maxLength={255} autoComplete="email" disabled={loading} value={form.email} onChange={event => update('email', event.target.value)} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label> : <><label className="block text-sm font-bold">Verification code<input required type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} disabled={loading} value={otp} onChange={event => setOtp(event.target.value.replace(/\D/g, '').slice(0,6))} aria-describedby="registration-otp-help" className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-3 text-center text-2xl tracking-[0.3em]" /></label><p id="registration-otp-help" className="text-xs leading-5 text-slate-500">The code expires in 10 minutes. Check your spam folder too.</p></>}
          <button disabled={loading || (step === 'email' && remaining > 0)} aria-busy={loading} className="login-submit">{loading ? step === 'email' ? 'Sending code...' : 'Verifying...' : step === 'email' ? remaining ? `Try again in ${remaining}s` : 'Send verification code' : 'Verify email'}</button>
          {step === 'otp' && <div className="flex items-center justify-between gap-4">
            <button type="button" disabled={loading} onClick={changeEmail} className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-semibold text-slate-600 transition-colors hover:text-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:opacity-50"><ArrowLeft size={15} aria-hidden="true" />Change email</button>
            <button type="button" disabled={loading || remaining > 0} onClick={sendCode} className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-semibold text-[var(--primary)] transition-colors hover:text-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:text-slate-400">{remaining ? <Clock3 size={15} aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />}{remaining ? `Resend in ${remaining}s` : 'Resend code'}</button>
          </div>}
        </form>}
        {step === 'details' && <form onSubmit={submit} className="mt-6 space-y-4">
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <div className="space-y-2">
            <div className="grid grid-cols-[minmax(0,1fr)_3rem] items-start gap-x-3 gap-y-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_3.5rem]">
              <label className="col-span-2 block min-w-0 text-sm font-bold sm:col-span-1">First name<input required maxLength={100} autoComplete="given-name" value={form.firstName} onChange={(event) => update('firstName', event.target.value)} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
              <label className="block min-w-0 text-sm font-bold">Last name<input required maxLength={100} autoComplete="family-name" value={form.lastName} onChange={(event) => update('lastName', event.target.value)} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
              <label className="block min-w-0 text-sm font-bold" title="Middle initial (optional)">MI <span className="sr-only">(optional)</span><input maxLength={3} pattern={middleInitialPattern.source} title={middleInitialMessage} autoComplete="additional-name" value={form.middleInitial} aria-invalid={invalidMiddleInitial(form.middleInitial)} aria-describedby={`register-mi-help${invalidMiddleInitial(form.middleInitial) ? ' register-mi-error' : ''}`} onChange={(event) => {
                event.target.setCustomValidity(invalidMiddleInitial(event.target.value) ? middleInitialMessage : '')
                update('middleInitial', event.target.value)
              }} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-2 py-2.5 text-center font-normal aria-invalid:border-red-400" /></label>
            </div>
            <p id="register-mi-help" className="text-xs leading-5 text-slate-500">MI (optional): 1–2 letters, with an optional period at the end.</p>
            {invalidMiddleInitial(form.middleInitial) && <p id="register-mi-error" role="alert" className="text-xs text-red-700">{middleInitialMessage}</p>}
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm"><p className="font-bold text-emerald-900">Email verified</p><p className="mt-1 break-all text-emerald-800">{form.email}</p><button type="button" disabled={loading} onClick={changeEmail} className="mt-1 min-h-11 font-bold text-emerald-800 underline">Change email</button></div>
          {(!grant || grantExpired) && <div role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><p>Email verification expired.</p><button type="button" onClick={changeEmail} className="mt-1 min-h-11 font-bold underline">Verify email again</button></div>}
          <PasswordInput label="Password" value={form.password} onChange={(event) => update('password', event.target.value)} />
          <PasswordInput label="Confirm password" confirmationFor={form.password} value={form.confirmPassword} onChange={(event) => update('confirmPassword', event.target.value)} />
          <button disabled={loading || !grant || grantExpired} aria-busy={loading} className="login-submit">{loading && <span className="login-spinner" aria-hidden="true" />}{loading ? 'Creating...' : 'Create account'}</button>
        </form>}
        <p className="mt-6 text-center text-sm text-slate-500">Already have an account? <Link to="/login" className="font-bold text-[var(--primary)] hover:underline">Back to sign in</Link></p>
      </section>
    </main>
  )
}

function RegistrationProgress({ step }) {
  const steps = [{ id:'email', label:'Email' }, { id:'otp', label:'Verify' }, { id:'details', label:'Details' }]
  const current = Math.max(0, steps.findIndex(item => item.id === step))
  return <div className="relative mt-6">
    <div aria-hidden="true" className="absolute left-[16.6667%] right-[16.6667%] top-[13px] h-0.5 overflow-hidden rounded-full bg-slate-200">
      <div className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-300 ease-out motion-reduce:transition-none" style={{ width:`${current*50}%` }} />
    </div>
    <ol aria-label="Registration progress" className="relative grid grid-cols-3">
      {steps.map((item,index) => <li key={item.id} aria-current={index === current ? 'step' : undefined} className="flex flex-col items-center gap-2 text-center">
        <span aria-hidden="true" className={`grid size-7 place-items-center rounded-full border-2 text-xs font-bold transition-colors duration-300 motion-reduce:transition-none ${index < current ? 'border-[var(--primary)] bg-[var(--primary)] text-white' : index === current ? 'border-[var(--primary)] bg-[var(--primary)] text-white ring-4 ring-emerald-50' : 'border-slate-200 bg-white text-slate-400'}`}>{index < current ? <Check size={14} strokeWidth={3} /> : index+1}</span>
        <span className={`text-xs ${index <= current ? 'font-bold text-emerald-800' : 'font-medium text-slate-400'}`}><span className="sr-only">Step {index+1}{index < current ? ', completed' : ''}: </span>{item.label}</span>
      </li>)}
    </ol>
  </div>
}
