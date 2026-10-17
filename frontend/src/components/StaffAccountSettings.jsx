import { useEffect, useState } from 'react'
import { CheckCircle2, Eye, EyeOff, KeyRound, Mail, RotateCw, Save, ShieldCheck, UserRound } from 'lucide-react'
import { Panel } from './DashboardLayout'
import OtpInput from './OtpInput'
import useAuth from '../hooks/useAuth'
import { apiRequest } from '../services/api'

const inputClass = 'mt-1.5 min-h-11 min-w-0 w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2.5 text-sm font-normal outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--active-bg)]'
const primaryClass = 'inline-flex w-full sm:w-auto min-h-11 items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-bold text-white transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 disabled:opacity-100'
const secondaryClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-sm font-bold text-emerald-800 transition hover:bg-emerald-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-500'
const emptyNotice = { error: '', message: '' }

function SettingsPanel({ icon: Icon, title, description, children }) {
  return <Panel className="settings-panel min-w-0" title={<span className="flex items-center gap-2.5"><Icon size={19} aria-hidden="true" className="shrink-0 text-[var(--primary)]" />{title}</span>} description={description}>{children}</Panel>
}

function FormActions({ children }) {
  return <div className="flex justify-end border-t border-[var(--border)] pt-4">{children}</div>
}

function Notice({ notice }) {
  if (!notice.error && !notice.message) return null
  return <p role={notice.error ? 'alert' : 'status'} className={`rounded-lg border p-3 text-sm ${notice.error ? 'border-red-100 bg-red-50 text-red-700' : 'border-emerald-100 bg-emerald-50 text-emerald-800'}`}>{notice.error || notice.message}</p>
}

function PasswordField({ label, value, onChange, current = false }) {
  const [visible, setVisible] = useState(false)
  return <label className="block text-sm font-semibold text-[var(--ink)]">{label}<div className="relative"><input required minLength={current ? 1 : 8} maxLength={72} type={visible ? 'text' : 'password'} autoComplete={current ? 'current-password' : 'new-password'} value={value} onChange={onChange} className={`${inputClass} pr-11`} /><button type="button" onClick={() => setVisible(value => !value)} aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`} className="absolute inset-y-0 right-0 mt-1.5 grid w-11 place-items-center rounded-lg text-[var(--muted)] hover:text-[var(--ink)]">{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
}

function NameSettings() {
  const { user, token, updateUser } = useAuth()
  const [name, setName] = useState(user.fullName)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(emptyNotice)

  async function save(event) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setNotice(emptyNotice)
    try {
      const result = await apiRequest('/api/account/profile', { method: 'PATCH', token, body: { fullName: name } })
      updateUser(result.user)
      setName(result.user.fullName)
      setNotice({ error: '', message: result.message })
    } catch (error) {
      setNotice({ error: error.message, message: '' })
    } finally { setSaving(false) }
  }

  return <SettingsPanel icon={UserRound} title="Profile details" description="Update the name shown on your account."><form onSubmit={save} className="space-y-4"><Notice notice={notice} /><label className="block text-sm font-semibold text-[var(--ink)]">Full name<input required maxLength={150} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} className={inputClass} /></label><FormActions><button disabled={saving || !name.trim() || name.trim() === user.fullName} aria-busy={saving} className={primaryClass}><Save size={16} aria-hidden="true" />{saving ? 'Saving...' : 'Save name'}</button></FormActions></form></SettingsPanel>
}

function EmailSettings() {
  const { user, token, updateUser, replaceToken } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(null)
  const [digits, setDigits] = useState(() => Array(6).fill(''))
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(emptyNotice)
  const [resendAt, setResendAt] = useState(0)
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const seconds = Math.max(0, Math.ceil((resendAt - now) / 1000))

  async function sendCode(event) {
    event?.preventDefault()
    if (busy || seconds) return
    setBusy(true)
    setNotice(emptyNotice)
    try {
      const result = await apiRequest('/api/account/email-change', { method: 'POST', token, body: { email, currentPassword: password } })
      setPending({ challengeId: result.challengeId, email: result.email })
      setResendAt(Date.now() + result.retryAfterSeconds * 1000)
      setDigits(Array(6).fill(''))
      setNotice({ error: '', message: 'Verification code sent. Check your inbox or spam folder.' })
    } catch (error) {
      if (error.data?.retryAfterSeconds) setResendAt(Date.now() + error.data.retryAfterSeconds * 1000)
      setNotice({ error: error.message, message: '' })
    } finally { setBusy(false) }
  }

  async function verify(event) {
    event.preventDefault()
    if (busy || digits.some(digit => !digit)) return
    setBusy(true)
    setNotice(emptyNotice)
    try {
      const result = await apiRequest('/api/account/email-change/verify', { method: 'POST', token, body: { challengeId: pending.challengeId, otp: digits.join('') } })
      updateUser(result.user)
      replaceToken(result.token)
      setPending(null)
      setEmail('')
      setPassword('')
      setDigits(Array(6).fill(''))
      setResendAt(0)
      setNotice({ error: '', message: result.message })
    } catch (error) {
      setNotice({ error: error.message, message: '' })
    } finally { setBusy(false) }
  }

  function cancel() {
    setPending(null)
    setPassword('')
    setDigits(Array(6).fill(''))
    setNotice(emptyNotice)
  }

  return (
    <SettingsPanel icon={Mail} title="Email address" description="Verify your new email before changing it.">
      <div className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] px-4 py-3"><p className="text-xs text-[var(--muted)]">Current email</p><p className="mt-1 flex items-start gap-2 break-all text-sm font-semibold text-[var(--ink)]"><CheckCircle2 size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-emerald-700" />{user.email}</p></div>
      <div className="space-y-4">
        <Notice notice={notice} />
        {pending ? <>
          <p className="text-sm leading-6 text-[var(--muted)]">Enter the code sent to <strong className="break-words text-[var(--ink)]">{pending.email}</strong>. It expires in 10 minutes.</p>
          <form onSubmit={verify} className="space-y-4"><OtpInput digits={digits} onChange={setDigits} disabled={busy} /><button disabled={busy || digits.some(digit => !digit)} aria-busy={busy} className={`${primaryClass} w-full`}><ShieldCheck size={17} aria-hidden="true" />{busy ? 'Verifying...' : 'Verify & change email'}</button></form>
          <div className="grid gap-3 sm:grid-cols-2"><button type="button" disabled={busy || Boolean(seconds)} onClick={() => sendCode()} className={secondaryClass}><RotateCw size={16} aria-hidden="true" />{seconds ? `Resend in ${seconds}s` : 'Resend code'}</button><button type="button" disabled={busy} onClick={cancel} className={secondaryClass}>Cancel change</button></div>
          <p className="text-xs leading-5 text-[var(--muted)]">Your current email stays active until verification.</p>
        </> : <form onSubmit={sendCode} className="space-y-4">
          <label className="block text-sm font-semibold text-[var(--ink)]">New email address<input required type="email" maxLength={255} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} /></label>
          <PasswordField label="Current password" current value={password} onChange={(event) => setPassword(event.target.value)} />
          <FormActions><button disabled={busy || Boolean(seconds)} aria-busy={busy} className={primaryClass}><Mail size={17} aria-hidden="true" />{busy ? 'Sending...' : seconds ? `Send code in ${seconds}s` : 'Send verification code'}</button></FormActions>
        </form>}
      </div>
    </SettingsPanel>
  )
}

function PasswordSettings() {
  const { token, replaceToken } = useAuth()
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmation: '' })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(emptyNotice)
  const update = (field, value) => setForm(current => ({ ...current, [field]: value }))

  async function save(event) {
    event.preventDefault()
    if (busy) return
    setNotice(emptyNotice)
    if (form.newPassword !== form.confirmation) {
      setNotice({ error: 'Passwords do not match.', message: '' })
      return
    }
    setBusy(true)
    try {
      const result = await apiRequest('/api/auth/change-password', { method: 'POST', token, body: { currentPassword: form.currentPassword, newPassword: form.newPassword } })
      replaceToken(result.token)
      setForm({ currentPassword: '', newPassword: '', confirmation: '' })
      setNotice({ error: '', message: result.message })
    } catch (error) {
      setNotice({ error: error.message, message: '' })
    } finally { setBusy(false) }
  }

  return <SettingsPanel icon={KeyRound} title="Password" description="Use at least 8 characters. Other sessions will be signed out."><form onSubmit={save} className="space-y-4"><Notice notice={notice} /><PasswordField label="Current password" current value={form.currentPassword} onChange={(event) => update('currentPassword', event.target.value)} /><div className="grid gap-4 min-[1440px]:grid-cols-2"><PasswordField label="New password" value={form.newPassword} onChange={(event) => update('newPassword', event.target.value)} /><PasswordField label="Confirm password" value={form.confirmation} onChange={(event) => update('confirmation', event.target.value)} /></div><FormActions><button disabled={busy} aria-busy={busy} className={primaryClass}><KeyRound size={17} aria-hidden="true" />{busy ? 'Saving...' : 'Change password'}</button></FormActions></form></SettingsPanel>
}

export default function StaffAccountSettings({ children }) {
  return (
    <div className="grid min-w-0 items-start gap-5 xl:grid-cols-2">
      <div className="min-w-0 space-y-5">
        <NameSettings />
        <PasswordSettings />
      </div>
      <div className="min-w-0 space-y-5">
        <EmailSettings />
        {children}
      </div>
    </div>
  )
}
