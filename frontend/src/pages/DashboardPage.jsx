import { useEffect, useState } from 'react'
import Logo from '../components/Logo'
import { Alert } from '../components/ui'
import { ROLES } from '../constants/roles'
import { useAuth } from '../context/AuthContext'
import { apiRequest } from '../lib/api'

const NAV_ITEMS = {
  ADMIN: ['Overview', 'User access', 'Property setup', 'System activity'],
  COLLECTOR: ['Overview', 'Collection queue', 'Payment records', 'Resident directory'],
  UNIT_OWNER: ['Overview', 'My account', 'Billing history', 'Property details'],
}

const NEXT_MODULES = {
  ADMIN: [
    ['Account administration', 'Provision staff and manage portal access.'],
    ['Property settings', 'Configure units and billing rules.'],
    ['Activity monitoring', 'Review important system events.'],
  ],
  COLLECTOR: [
    ['Collection workspace', 'Organize and record resident collections.'],
    ['Payment records', 'Review submitted payment information.'],
    ['Resident lookup', 'Find owners and their account context.'],
  ],
  UNIT_OWNER: [
    ['Account summary', 'Review your unit billing information.'],
    ['Billing history', 'Access future statements and transactions.'],
    ['Property profile', 'Keep your unit details in one place.'],
  ],
}

export default function DashboardPage({ role }) {
  const roleInfo = ROLES[role]
  const { user, token, logout } = useAuth()
  const [status, setStatus] = useState({ loading: true, message: '', error: '' })

  useEffect(() => {
    let active = true
    apiRequest(roleInfo.endpoint, { token })
      .then((data) => active && setStatus({ loading: false, message: data.message, error: '' }))
      .catch((error) => active && setStatus({ loading: false, message: '', error: error.message }))
    return () => { active = false }
  }, [roleInfo.endpoint, token])

  return (
    <div className="min-h-screen bg-slate-50 lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="hidden min-h-screen border-r border-slate-200 bg-white p-6 lg:flex lg:flex-col">
        <Logo />
        <nav className="mt-12 space-y-2">
          {NAV_ITEMS[role].map((item, index) => (
            <button key={item} disabled={index > 0} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold ${index === 0 ? 'bg-indigo-50 text-indigo-700' : 'cursor-not-allowed text-slate-400'}`}>
              <span className={`size-2 rounded-full ${index === 0 ? 'bg-indigo-600' : 'bg-slate-300'}`} />{item}
            </button>
          ))}
        </nav>
        <div className="mt-auto rounded-2xl bg-slate-950 p-5 text-white">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Signed in as</p>
          <p className="mt-3 truncate text-sm font-bold">{user.fullName}</p>
          <p className="mt-1 truncate text-xs text-slate-400">{user.email}</p>
          <button onClick={logout} className="mt-5 text-xs font-bold text-indigo-300 hover:text-white">Sign out →</button>
        </div>
      </aside>

      <main className="min-w-0">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4 sm:px-8 lg:px-10">
          <div className="lg:hidden"><Logo /></div>
          <div className="hidden lg:block">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Workspace</p>
            <p className="mt-1 text-sm font-bold text-slate-800">{roleInfo.label} portal</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 sm:block">{roleInfo.label}</span>
            <button onClick={logout} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 lg:hidden">Sign out</button>
            <div className="grid size-10 place-items-center rounded-full bg-indigo-600 text-sm font-bold text-white">{user.fullName?.charAt(0).toUpperCase()}</div>
          </div>
        </header>

        <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:px-10 lg:py-12">
          <section className="rounded-3xl bg-indigo-950 px-6 py-8 text-white shadow-xl shadow-indigo-950/10 sm:px-9 sm:py-10">
            <div className="flex flex-col justify-between gap-8 sm:flex-row sm:items-end">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-300">{roleInfo.shortLabel} overview</p>
                <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Welcome, {user.fullName?.split(' ')[0]}.</h1>
                <p className="mt-3 max-w-xl text-sm leading-6 text-indigo-200">Your role-specific workspace is connected and ready for the next property billing modules.</p>
              </div>
              <span className="w-fit rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-xs font-bold text-emerald-300">● Authenticated session</span>
            </div>
          </section>

          <section className="mt-6">
            {status.error && <Alert>{status.error}</Alert>}
            {!status.error && (
              <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                <span className="grid size-8 place-items-center rounded-full bg-emerald-600 font-bold text-white">✓</span>
                <div><p className="font-bold">Backend authorization verified</p><p className="mt-0.5 text-xs text-emerald-700">{status.loading ? 'Checking your role endpoint…' : status.message}</p></div>
              </div>
            )}
          </section>

          <section className="mt-9">
            <div className="flex items-end justify-between">
              <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-600">Workspace roadmap</p><h2 className="mt-2 text-xl font-bold text-slate-950">Modules prepared for this role</h2></div>
              <span className="hidden text-xs font-semibold text-slate-400 sm:block">Interface preview</span>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              {NEXT_MODULES[role].map(([title, description], index) => (
                <article key={title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <span className="grid size-10 place-items-center rounded-xl bg-slate-100 text-sm font-bold text-slate-500">0{index + 1}</span>
                  <h3 className="mt-5 text-base font-bold text-slate-900">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
                  <span className="mt-5 inline-block rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Coming next</span>
                </article>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
