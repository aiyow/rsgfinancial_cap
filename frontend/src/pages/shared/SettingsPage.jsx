import { useState } from 'react'
import { Settings2 } from 'lucide-react'
import DashboardLayout, { Panel } from '../../components/DashboardLayout'
import StaffAccountSettings from '../../components/StaffAccountSettings'
import useAuth from '../../hooks/useAuth'

export default function SettingsPage() {
  const { user } = useAuth()
  const isStaff = ['ADMIN', 'COLLECTOR'].includes(user.role)
  const [compactSidebar, setCompactSidebar] = useState(() => localStorage.getItem('rsg_sidebar_collapsed') === 'true')

  function updateSidebarPreference(event) {
    const nextValue = event.target.checked
    setCompactSidebar(nextValue)
    localStorage.setItem('rsg_sidebar_collapsed', String(nextValue))
    window.dispatchEvent(new CustomEvent('rsg-sidebar-preference', { detail: { collapsed: nextValue } }))
  }

  const workspaceSettings = <WorkspaceSettings compactSidebar={compactSidebar} onChange={updateSidebarPreference} />

  return (
    <DashboardLayout title="Settings" className="settings-shell">
      <div id="account-profile" className={`${isStaff ? 'max-w-6xl' : 'max-w-3xl'} min-w-0 scroll-mt-20 space-y-6`}>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--ink)]">{isStaff ? 'Account settings' : 'Workspace settings'}</h1>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{isStaff ? 'Manage your personal information, account security, and workspace.' : 'Make your workspace work for you.'}</p>
        </div>
        {isStaff ? <StaffAccountSettings>{workspaceSettings}</StaffAccountSettings> : workspaceSettings}
      </div>
    </DashboardLayout>
  )
}

function WorkspaceSettings({ compactSidebar, onChange }) {
  return (
    <Panel className="settings-panel min-w-0" title={<span className="flex items-center gap-2.5"><Settings2 size={19} aria-hidden="true" className="shrink-0 text-[var(--primary)]" />Workspace preferences</span>} description="These preferences are saved for this browser.">
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border)] p-4 transition hover:bg-[var(--app-bg)]">
        <input type="checkbox" checked={compactSidebar} onChange={onChange} className="mt-1 size-4 shrink-0 accent-[var(--primary)]" />
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-[var(--ink)]">Use compact sidebar</span>
          <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">Keep the sidebar collapsed on larger screens and show navigation icons only.</span>
        </span>
      </label>
    </Panel>
  )
}
