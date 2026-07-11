import { useEffect, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import {
  BarChart3,
  BookOpen,
  Building2,
  Calculator,
  ChevronDown,
  ClipboardList,
  CreditCard,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Settings2,
  ShieldCheck,
  Upload,
  UserRound,
  Users,
  WalletCards,
  X,
} from 'lucide-react'
import useAuth from '../hooks/useAuth'

const navigationByRole = {
  ADMIN: {
    view: [
      { label: 'Dashboard', to: '/admin', end: true, icon: LayoutDashboard },
      { label: 'Unit Directory', to: '/admin/units', end: true, icon: Building2 },
      { label: 'Forwarded SOAs', to: '/admin/soa', icon: FileText },
      { label: 'Payments', to: '/admin/payments', icon: CreditCard },
      { label: 'Audit Logs', to: '/admin/audit-logs', icon: ScrollText },
      { label: 'Water Analytics', to: '/admin/analytics', icon: BarChart3 },
    ],
    manage: [
      { label: 'User Management', to: '/admin/users', icon: Users },
      { label: 'Manage Units', to: '/admin/units/manage', icon: Settings2 },
      { label: 'Assignments', to: '/admin/assignments', icon: ClipboardList },
    ],
  },
  COLLECTOR: {
    view: [
      { label: 'Dashboard', to: '/collector', end: true, icon: LayoutDashboard },
      { label: 'Bills & SOAs', to: '/collector/bills', icon: FileText },
      { label: 'Units', to: '/collector/units', icon: Building2 },
      { label: 'Verified Payments', to: '/collector/payments', icon: WalletCards },
      { label: 'Water Analytics', to: '/collector/analytics', icon: BarChart3 },
    ],
    manage: [
      { label: 'Monthly Billing', to: '/collector/billing', icon: Calculator },
      { label: 'SOA Template', to: '/collector/soa-template', icon: BookOpen },
      { label: 'Analytics Import', to: '/collector/history-import', icon: Upload },
    ],
  },
  RESIDENT: {
    view: [
      { label: 'Dashboard', to: '/resident', end: true, icon: LayoutDashboard },
      { label: 'My SOAs', to: '/resident/bills', icon: FileText },
      { label: 'Payment History', to: '/resident/payments', icon: CreditCard },
    ],
    manage: [],
  },
}

const sectionLabels = {
  view: 'View',
  manage: 'Manage',
}

function NavigationLinks({ sections, collapsed, onNavigate }) {
  return (
    <nav className="space-y-5" aria-label="Main navigation">
      {Object.entries(sections).map(([sectionKey, items]) => {
        if (!items.length) return null

        return (
          <div key={sectionKey}>
            <p className={`mb-2 px-3 text-[9px] font-bold uppercase tracking-[0.18em] text-[var(--muted)] ${collapsed ? 'lg:text-center' : ''}`}>
              {collapsed ? sectionKey.slice(0, 1) : sectionLabels[sectionKey]}
            </p>
            <div className="space-y-1">
              {items.map((item) => {
                const Icon = item.icon

                return (
                  <NavLink
                    key={item.label}
                    to={item.to}
                    end={item.end}
                    title={collapsed ? item.label : undefined}
                    onClick={onNavigate}
                    className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-semibold transition ${
                    collapsed ? 'lg:justify-center' : ''
                    } ${isActive
                      ? 'bg-[var(--active-bg)] text-[var(--primary)] shadow-sm'
                      : 'text-[var(--sidebar-ink)] hover:bg-white/70 hover:text-[var(--primary)]'
                    }`}
                  >
                    <Icon size={18} strokeWidth={2} aria-hidden="true" />
                    <span className={collapsed ? 'lg:sr-only' : ''}>{item.label}</span>
                  </NavLink>
                )
              })}
            </div>
          </div>
        )
      })}
    </nav>
  )
}

export default function DashboardLayout({ title, description, children }) {
  const { user, logout } = useAuth()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('rsg_sidebar_collapsed') === 'true')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const profileMenuRef = useRef(null)
  const sections = navigationByRole[user.role] || navigationByRole.RESIDENT

  useEffect(() => {
    localStorage.setItem('rsg_sidebar_collapsed', String(collapsed))
  }, [collapsed])

  useEffect(() => {
    function applySidebarPreference(event) {
      if (typeof event.detail?.collapsed === 'boolean') setCollapsed(event.detail.collapsed)
    }

    window.addEventListener('rsg-sidebar-preference', applySidebarPreference)
    return () => window.removeEventListener('rsg-sidebar-preference', applySidebarPreference)
  }, [])

  useEffect(() => {
    if (!mobileOpen) return undefined

    function closeOnEscape(event) {
      if (event.key === 'Escape') setMobileOpen(false)
    }

    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [mobileOpen])

  useEffect(() => {
    if (!profileOpen) return undefined

    function closeOnOutsideClick(event) {
      if (!profileMenuRef.current?.contains(event.target)) setProfileOpen(false)
    }

    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => document.removeEventListener('mousedown', closeOnOutsideClick)
  }, [profileOpen])

  const portalLabel = {
    ADMIN: 'Admin Portal',
    COLLECTOR: 'Collector Portal',
    RESIDENT: 'Resident Portal',
  }[user.role] || 'RSG Condo'
  const initials = user.fullName.split(' ').map((name) => name[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className={`dashboard-shell min-h-screen bg-[var(--app-bg)] text-[var(--ink)] lg:grid ${collapsed ? 'lg:grid-cols-[64px_1fr]' : 'lg:grid-cols-[240px_1fr]'}`}>
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
          className="print-hidden fixed inset-0 z-30 bg-[var(--ink)]/25 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside className={`print-hidden fixed inset-y-0 left-0 z-40 flex w-[280px] flex-col border-r border-[var(--border)] bg-[var(--sidebar-bg)] transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:w-auto lg:translate-x-0 ${
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <div className={`flex h-14 shrink-0 items-center justify-between border-b border-[var(--border)] px-5 ${collapsed ? 'lg:justify-center lg:px-3' : ''}`}>
          <div className={`flex items-center gap-3 ${collapsed ? 'lg:gap-0' : ''}`}>
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--primary)] text-white shadow-sm">
              <ShieldCheck size={22} strokeWidth={2.2} aria-hidden="true" />
            </span>
            <div className={collapsed ? 'lg:sr-only' : ''}>
              <p className="text-sm font-black tracking-tight text-[var(--ink)]">RSG Condo</p>
              <p className="mt-0.5 text-[10px] font-black uppercase tracking-[0.16em] text-[var(--muted)]">{user.role}</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close navigation"
            title="Close navigation"
            onClick={() => setMobileOpen(false)}
            className="rounded-lg p-2 text-[var(--muted)] hover:bg-white/70 hover:text-[var(--ink)] lg:hidden"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className={`min-h-0 flex-1 overflow-y-auto px-3 py-5 ${collapsed ? 'lg:px-2' : ''}`}>
          <NavigationLinks sections={sections} collapsed={collapsed} onNavigate={() => setMobileOpen(false)} />
        </div>

        <div className="shrink-0 border-t border-[var(--border)] p-3">
          <button
            type="button"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setCollapsed((value) => !value)}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-semibold text-[var(--muted)] transition hover:bg-white/70 hover:text-[var(--primary)] ${collapsed ? 'lg:justify-center' : ''}`}
          >
            {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
            <span className={collapsed ? 'lg:sr-only' : ''}>{collapsed ? 'Expand' : 'Collapse'}</span>
          </button>
        </div>
      </aside>

      <main className="min-w-0 bg-[var(--app-bg)]">
        <header className="print-hidden sticky top-0 z-20 border-b border-[var(--border)] bg-white/95 shadow-[0_4px_18px_rgba(28,78,48,0.06)] backdrop-blur">
          <div className="mx-auto flex min-h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                aria-label="Open navigation"
                title="Open navigation"
                onClick={() => setMobileOpen(true)}
                className="rounded-lg border border-[var(--border)] bg-[var(--app-bg)] p-2 text-[var(--primary)] hover:bg-[var(--active-bg)] lg:hidden"
              >
                <Menu size={19} aria-hidden="true" />
              </button>
              <div className="flex min-w-0 items-center gap-2 text-sm">
                <span className="truncate font-bold text-[var(--ink)]">{portalLabel}</span>
                <span className="text-[var(--muted)]">/</span>
                <span className="truncate text-[var(--muted)]">{title}</span>
              </div>
            </div>

            <div ref={profileMenuRef} className="relative shrink-0">
              <button
                type="button"
                aria-expanded={profileOpen}
                aria-haspopup="menu"
                aria-label={`Open account menu for ${user.fullName}`}
                onClick={() => setProfileOpen((value) => !value)}
                className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-2 py-1.5 text-left hover:bg-[var(--app-bg)] sm:gap-3 sm:px-2.5"
              >
                <span className="grid size-7 place-items-center rounded-sm bg-[var(--primary)] text-[10px] font-black text-white">{initials}</span>
                <span className="hidden min-w-0 sm:block">
                  <span className="block max-w-36 truncate text-xs font-bold text-[var(--ink)]">{user.fullName}</span>
                  <span className="block max-w-36 truncate text-[10px] text-[var(--muted)]">{user.role}</span>
                </span>
                <ChevronDown size={14} className={`text-[var(--muted)] transition ${profileOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>

              {profileOpen && (
                <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-60 overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-lg" role="menu">
                  <div className="border-b border-[var(--border)] px-4 py-3">
                    <p className="truncate text-sm font-bold text-[var(--ink)]">{user.fullName}</p>
                    <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{user.email}</p>
                  </div>
                  <Link to="/profile" role="menuitem" onClick={() => setProfileOpen(false)} className="flex items-center gap-3 px-4 py-3 text-sm text-[var(--ink)] hover:bg-[var(--app-bg)]">
                    <UserRound size={17} aria-hidden="true" />
                    Profile
                  </Link>
                  <Link to="/settings" role="menuitem" onClick={() => setProfileOpen(false)} className="flex items-center gap-3 px-4 py-3 text-sm text-[var(--ink)] hover:bg-[var(--app-bg)]">
                    <Settings2 size={17} aria-hidden="true" />
                    Settings
                  </Link>
                  <div className="border-t border-[var(--border)]">
                    <button type="button" role="menuitem" onClick={logout} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-[var(--ink)] hover:bg-red-50 hover:text-red-700">
                      <LogOut size={17} aria-hidden="true" />
                      Sign out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <div className="mb-6 sm:hidden">
            <p className="text-xs text-[var(--muted)]">{description}</p>
          </div>
          <div className="space-y-8">{children}</div>
        </div>
      </main>
    </div>
  )
}

export function Panel({ id, title, description, children }) {
  return (
    <section id={id} className="rounded-2xl border border-[var(--border)] bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-lg font-black text-[var(--ink)]">{title}</h2>
      {description && <p className="mt-1 text-sm text-[var(--muted)]">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  )
}

export function EmptyRow({ message }) {
  return <p className="rounded-lg bg-[var(--app-bg)] p-4 text-center text-sm text-[var(--muted)]">{message}</p>
}
