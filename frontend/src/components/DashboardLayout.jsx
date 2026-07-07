import useAuth from '../hooks/useAuth'
import { NavLink } from 'react-router-dom'

const navByRole = {
  ADMIN: [
    { label: 'Dashboard', to: '/admin', end: true },
    { label: 'Users', to: '/admin/users' },
    { label: 'View Units', to: '/admin/units', end: true },
    { label: 'Manage Units', to: '/admin/units/manage' },
    { label: 'Assignments', to: '/admin/assignments' },
    { label: 'Forwarded SOAs', to: '/admin/soa' },
    { label: 'Payments', to: '/admin/payments' },
    { label: 'Audit Logs', to: '/admin/audit-logs' },
  ],
  COLLECTOR: [
    { label: 'Dashboard', to: '/collector', end: true },
    { label: 'Billing', to: '/collector/billing' },
    { label: 'Bills & SOAs', to: '/collector/bills' },
    { label: 'Units', to: '/collector/units' },
    { label: 'Verified Payments', to: '/collector/payments' },
  ],
  RESIDENT: [
    { label: 'Dashboard', to: '/resident', end: true },
    { label: 'My SOAs', to: '/resident/bills' },
    { label: 'Payment History', to: '/resident/payments' },
  ],
}

export default function DashboardLayout({ title, description, children }) {
  const { user, logout } = useAuth()

  return (
    <div className="dashboard-shell min-h-screen bg-slate-100 lg:grid lg:grid-cols-[230px_1fr]">
      <aside className="print-hidden border-b border-slate-200 bg-white p-5 lg:min-h-screen lg:border-b-0 lg:border-r lg:p-6">
        <div className="flex items-center justify-between lg:block">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-indigo-600 font-black text-white">C</span>
            <div><p className="text-sm font-black">Condo Portal</p><p className="text-xs text-slate-400">{user.role}</p></div>
          </div>
          <button onClick={logout} className="text-xs font-bold text-red-600 lg:hidden">Log out</button>
        </div>

        <nav className="mt-10 hidden space-y-2 lg:block">
          {navByRole[user.role].map((item) => (
            item.to.startsWith('#')
              ? <a key={item.label} href={item.to} className="block rounded-lg px-3 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100">{item.label}</a>
              : <NavLink key={item.label} to={item.to} end={item.end} className={({ isActive }) => `block rounded-lg px-3 py-2.5 text-sm font-bold ${isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}>{item.label}</NavLink>
          ))}
        </nav>

        <div className="mt-10 hidden border-t border-slate-200 pt-5 lg:block">
          <p className="truncate text-sm font-bold text-slate-800">{user.fullName}</p>
          <p className="mt-1 truncate text-xs text-slate-400">{user.email}</p>
          <button onClick={logout} className="mt-4 text-xs font-bold text-red-600">Log out</button>
        </div>
      </aside>

      <main className="min-w-0 p-5 sm:p-8">
        <div className="mx-auto max-w-6xl">
          <header className="print-hidden">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">{user.role} workspace</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">{title}</h1>
            <p className="mt-2 text-sm text-slate-500">{description}</p>
          </header>
          <div className="mt-8 space-y-8">{children}</div>
        </div>
      </main>
    </div>
  )
}

export function Panel({ id, title, description, children }) {
  return (
    <section id={id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-lg font-black text-slate-950">{title}</h2>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  )
}

export function EmptyRow({ message }) {
  return <p className="rounded-lg bg-slate-50 p-4 text-center text-sm text-slate-500">{message}</p>
}
