import { useState } from 'react'
import DashboardLayout, { Panel } from '../../components/DashboardLayout'

export default function SettingsPage() {
  const [compactSidebar, setCompactSidebar] = useState(() => localStorage.getItem('rsg_sidebar_collapsed') === 'true')

  function updateSidebarPreference(event) {
    const nextValue = event.target.checked
    setCompactSidebar(nextValue)
    localStorage.setItem('rsg_sidebar_collapsed', String(nextValue))
    window.dispatchEvent(new CustomEvent('rsg-sidebar-preference', { detail: { collapsed: nextValue } }))
  }

  return (
    <DashboardLayout title="Settings" description="Manage your workspace preferences.">
      <div className="max-w-3xl">
        <Panel title="Workspace settings" description="These preferences are saved for this browser.">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border)] p-4 hover:bg-[var(--app-bg)]">
            <input type="checkbox" checked={compactSidebar} onChange={updateSidebarPreference} className="mt-1 size-4 accent-[var(--primary)]" />
            <span>
              <span className="block text-sm font-semibold text-[var(--ink)]">Use compact sidebar</span>
              <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">Keep the sidebar collapsed on larger screens and show navigation icons only.</span>
            </span>
          </label>
        </Panel>
      </div>
    </DashboardLayout>
  )
}
