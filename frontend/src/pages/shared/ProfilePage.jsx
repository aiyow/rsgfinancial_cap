import DashboardLayout, { Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'

export default function ProfilePage() {
  const { user } = useAuth()

  return (
    <DashboardLayout title="Profile" description="View your account information and role access.">
      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Panel title="Account information" description="Your current RSG Condo account details.">
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
              <dd className="rounded-full bg-[var(--active-bg)] px-2.5 py-1 text-xs font-bold text-[var(--primary)]">{user.role}</dd>
            </div>
          </dl>
        </Panel>

        <Panel title="Access summary" description="Your available workspace is based on your assigned role.">
          <div className="rounded-lg bg-[var(--app-bg)] p-4 text-sm leading-6 text-[var(--sidebar-ink)]">
            You are signed in to the <span className="font-bold">{user.role.toLowerCase()}</span> workspace. Use the sidebar to view the pages available to your account.
          </div>
        </Panel>
      </div>
    </DashboardLayout>
  )
}
