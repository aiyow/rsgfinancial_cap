import { useState } from 'react'
import { Eye, EyeOff, KeyRound } from 'lucide-react'
import DashboardLayout, { Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

const roleLabel = (role) => ({ ADMIN: 'Admin', COLLECTOR: 'Billing Associate', RESIDENT: 'Resident' }[role] || role)

export default function ProfilePage() {
  const { user, token, replaceToken } = useAuth()
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmation: '' })
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [notice, setNotice] = useState({ error: '', message: '' })
  const [submitting, setSubmitting] = useState(false)

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function changePassword(event) {
    event.preventDefault()
    setNotice({ error: '', message: '' })

    if (form.newPassword !== form.confirmation) {
      setNotice({ error: 'New password and confirmation do not match.', message: '' })
      return
    }

    setSubmitting(true)
    try {
      const result = await apiRequest('/api/auth/change-password', {
        method: 'POST',
        token,
        body: { currentPassword: form.currentPassword, newPassword: form.newPassword },
      })
      replaceToken(result.token)
      setForm({ currentPassword: '', newPassword: '', confirmation: '' })
      setNotice({ error: '', message: result.message })
    } catch (error) {
      setNotice({ error: error.message, message: '' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <DashboardLayout title="Profile" description="View your account information and role access.">
      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Panel title="Account information" description="Your current The ResiDens account details.">
          <dl className="divide-y divide-[var(--border)]">
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-sm text-[var(--muted)]">Full name</dt>
              <dd className="text-right text-sm font-semibold text-[var(--ink)]">{user.fullName}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-sm text-[var(--muted)]">Email address</dt>
              <dd className="text-right text-sm font-semibold text-[var(--ink)]">{user.email}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-sm text-[var(--muted)]">Role</dt>
              <dd className="rounded-full bg-[var(--active-bg)] px-2.5 py-1 text-xs font-bold text-[var(--primary)]">{roleLabel(user.role)}</dd>
            </div>
          </dl>
        </Panel>

        <Panel title="Access summary" description="Your available workspace is based on your assigned role.">
          <div className="rounded-lg bg-[var(--app-bg)] p-4 text-sm leading-6 text-[var(--sidebar-ink)]">
            You are signed in to the <span className="font-bold">{roleLabel(user.role).toLowerCase()}</span> workspace. Use the sidebar to view the pages available to your account.
          </div>
        </Panel>
      </div>

      {user.role === 'RESIDENT' && (
        <div className="mt-6 max-w-3xl">
          <Panel title="Password" description="Change your password without changing your account details.">
            <form onSubmit={changePassword} className="space-y-4">
              {notice.error && <p role="alert" className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">{notice.error}</p>}
              {notice.message && <p role="status" className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800">{notice.message}</p>}
              <PasswordField label="Current password" value={form.currentPassword} visible={showCurrentPassword} onChange={(event) => updateField('currentPassword', event.target.value)} onToggle={() => setShowCurrentPassword((current) => !current)} autoComplete="current-password" />
              <PasswordField label="New password" value={form.newPassword} visible={showNewPassword} onChange={(event) => updateField('newPassword', event.target.value)} onToggle={() => setShowNewPassword((current) => !current)} autoComplete="new-password" />
              <PasswordField label="Confirm new password" value={form.confirmation} visible={showConfirmation} onChange={(event) => updateField('confirmation', event.target.value)} onToggle={() => setShowConfirmation((current) => !current)} autoComplete="new-password" />
              <div className="flex justify-end"><button disabled={submitting} className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"><KeyRound size={17} />{submitting ? 'Changing password...' : 'Change password'}</button></div>
            </form>
          </Panel>
        </div>
      )}
    </DashboardLayout>
  )
}

function PasswordField({ label, value, visible, onChange, onToggle, autoComplete }) {
  return <label className="block text-sm font-semibold text-[var(--ink)]">{label}<div className="relative mt-1.5"><input required minLength="8" maxLength="72" type={visible ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={onChange} className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2.5 pr-11 text-sm font-normal outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--active-bg)]" /><button type="button" onClick={onToggle} aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-[var(--muted)] hover:text-[var(--ink)]">{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
}
