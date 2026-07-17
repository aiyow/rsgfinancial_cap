import { useCallback, useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, Plus, Search, X } from 'lucide-react'
import DashboardLayout, { EmptyRow } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

const blankUser = { firstName: '', middleInitial: '', lastName: '', email: '', password: '', confirmPassword: '', role: 'RESIDENT' }
const inputClass = 'mt-1.5 w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--active-bg)]'
const actionClass = 'rounded-md border border-[var(--border)] bg-white px-2.5 py-1.5 text-xs font-bold text-[var(--ink)] transition hover:border-[var(--primary)] hover:bg-[var(--app-bg)]'

function splitName(fullName = '') {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: '', middleInitial: '', lastName: '' }
  if (parts.length === 1) return { firstName: parts[0], middleInitial: '', lastName: '' }
  return { firstName: parts[0], middleInitial: parts.slice(1, -1).join(' '), lastName: parts.at(-1) }
}

function fullName({ firstName, middleInitial, lastName }) {
  return [firstName, middleInitial, lastName].map((value) => value.trim()).filter(Boolean).join(' ')
}

function Field({ label, children }) {
  return <label className="block text-xs font-bold text-[var(--muted)]">{label}{children}</label>
}

function PasswordField({ disabled = false, label, required = false, value, onChange }) {
  const [visible, setVisible] = useState(false)
  return <Field label={label}><div className="relative mt-1.5"><input required={required} disabled={disabled} minLength="8" type={visible ? 'text' : 'password'} value={value} onChange={onChange} className={`${inputClass.replace('mt-1.5 ', '')} pr-11 disabled:bg-slate-100 disabled:text-slate-400`} /><button type="button" disabled={disabled} onClick={() => setVisible((current) => !current)} aria-label={visible ? 'Hide password' : 'Show password'} className="absolute inset-y-0 right-0 grid w-10 place-items-center text-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-40">{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></Field>
}

export default function AdminUsersPage() {
  const { token, user: currentUser } = useAuth()
  const [users, setUsers] = useState([])
  const [form, setForm] = useState(blankUser)
  const [editingId, setEditingId] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [notice, setNotice] = useState({ error: '', message: '' })
  const editingSelf = Number(editingId) === Number(currentUser.id)

  const loadUsers = useCallback(async () => {
    const data = await apiRequest('/api/users', { token })
    setUsers(data.users)
  }, [token])

  useEffect(() => {
    let active = true
    apiRequest('/api/users', { token })
      .then((data) => { if (active) setUsers(data.users) })
      .catch((error) => { if (active) setNotice({ error: error.message, message: '' }) })
    return () => { active = false }
  }, [token])

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase()
    return users.filter((user) => {
      const matchesSearch = !term || `${user.fullName} ${user.email}`.toLowerCase().includes(term)
      const matchesRole = roleFilter === 'ALL' || user.role === roleFilter
      const matchesStatus = statusFilter === 'ALL' || (statusFilter === 'ACTIVE' ? user.isActive : !user.isActive)
      return matchesSearch && matchesRole && matchesStatus
    })
  }, [roleFilter, search, statusFilter, users])

  async function runAction(action, message) {
    setNotice({ error: '', message: '' })
    try {
      await action()
      await loadUsers()
      setNotice({ error: '', message })
      return true
    } catch (error) {
      setNotice({ error: error.message, message: '' })
      return false
    }
  }

  function openCreate() {
    setEditingId(null)
    setForm(blankUser)
    setModalOpen(true)
  }

  function startEdit(user) {
    setEditingId(user.id)
    setForm({ ...splitName(user.fullName), email: user.email, password: '', confirmPassword: '', role: user.role })
    setModalOpen(true)
  }

  function closeModal() {
    setEditingId(null)
    setForm(blankUser)
    setModalOpen(false)
  }

  async function saveUser(event) {
    event.preventDefault()
    if (form.password !== form.confirmPassword) {
      setNotice({ error: 'Password and confirmation do not match.', message: '' })
      return
    }
    const body = {
      fullName: fullName(form),
      email: form.email,
      role: form.role,
      ...(form.password ? { password: form.password } : {}),
    }
    const saved = await runAction(
      () => apiRequest(editingId ? `/api/users/${editingId}` : '/api/users', { method: editingId ? 'PATCH' : 'POST', token, body }),
      editingId ? 'User updated.' : 'User created.',
    )
    if (saved) closeModal()
  }

  return (
    <DashboardLayout title="User management" description="Manage Admin, Collector, and Resident accounts.">
      {(notice.error || notice.message) && <p className={`rounded-lg p-3 text-sm ${notice.error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{notice.error || notice.message}</p>}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-2xl font-black tracking-tight text-[var(--ink)]">User management</h1><p className="mt-1 text-sm text-[var(--muted)]">{users.length} accounts · {users.filter((user) => user.isActive).length} active</p></div>
        <button type="button" onClick={openCreate} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:brightness-95"><Plus size={17} /> Add user</button>
      </div>

      <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-sm">
        <div className="grid gap-3 border-b border-[var(--border)] p-4 md:grid-cols-[minmax(260px,1fr)_180px_180px_auto] md:items-center">
          <label className="relative"><Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or email..." className="w-full rounded-lg border border-[var(--border)] bg-white py-2.5 pl-10 pr-3 text-sm outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--active-bg)]" /></label>
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className={inputClass.replace('mt-1.5 ', '')}><option value="ALL">Role: all</option><option value="ADMIN">Admin</option><option value="COLLECTOR">Collector</option><option value="RESIDENT">Resident</option></select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={inputClass.replace('mt-1.5 ', '')}><option value="ALL">Status: all</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select>
          <p className="text-right text-xs font-bold text-[var(--muted)]">{filteredUsers.length} of {users.length}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-[var(--app-bg)] text-[11px] uppercase tracking-[0.08em] text-[var(--muted)]"><tr><th className="px-4 py-3 font-bold">User</th><th className="px-4 py-3 font-bold">Email</th><th className="px-4 py-3 font-bold">Role</th><th className="px-4 py-3 font-bold">Status</th><th className="px-4 py-3 text-right font-bold">Actions</th></tr></thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filteredUsers.map((user) => <tr key={user.id} className="transition hover:bg-[var(--app-bg)]"><td className="px-4 py-3.5 font-bold text-[var(--ink)]">{user.fullName}</td><td className="px-4 py-3.5 text-[var(--muted)]">{user.email}</td><td className="px-4 py-3.5"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{user.role}</span></td><td className="px-4 py-3.5"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${user.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{user.isActive ? 'Active' : 'Inactive'}</span></td><td className="px-4 py-3.5"><div className="flex justify-end gap-2"><button type="button" className={actionClass} onClick={() => startEdit(user)}>Edit</button>{Number(user.id) !== Number(currentUser.id) && <button type="button" className={actionClass} onClick={() => runAction(() => apiRequest(`/api/users/${user.id}`, { method: 'PATCH', token, body: { isActive: !user.isActive } }), 'User updated.')}>{user.isActive ? 'Deactivate' : 'Activate'}</button>}{Number(user.id) !== Number(currentUser.id) && <button type="button" className={`${actionClass} text-red-600`} onClick={() => window.confirm('Permanently delete this user and their unit assignment records?') && runAction(() => apiRequest(`/api/users/${user.id}`, { method: 'DELETE', token }), 'User deleted.')}>Delete</button>}</div></td></tr>)}
            </tbody>
          </table>
        </div>
        {filteredUsers.length === 0 && <div className="p-4"><EmptyRow message={users.length ? 'No users match the current filters.' : 'No users found.'} /></div>}
      </section>

      {modalOpen && <UserModal editingSelf={editingSelf} editing={Boolean(editingId)} form={form} onChange={(field, value) => setForm((current) => ({ ...current, [field]: value }))} onClose={closeModal} onSave={saveUser} />}
    </DashboardLayout>
  )
}

function UserModal({ editing, editingSelf, form, onChange, onClose, onSave }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-4" role="presentation" onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="user-modal-title" className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl sm:p-6" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4"><div><h2 id="user-modal-title" className="text-xl font-black text-[var(--ink)]">{editing ? 'Edit user' : 'Add user'}</h2><p className="mt-1 text-sm text-[var(--muted)]">First and last names are required. MI is optional.</p></div><button type="button" onClick={onClose} aria-label="Close user modal" className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--app-bg)]"><X size={18} /></button></div>
        <form onSubmit={onSave} className="mt-6 grid gap-4 sm:grid-cols-6">
          <div className="sm:col-span-2"><Field label="First name"><input required value={form.firstName} onChange={(event) => onChange('firstName', event.target.value)} className={inputClass} /></Field></div>
          <div className="sm:col-span-1"><Field label="MI (optional)"><input maxLength="20" value={form.middleInitial} onChange={(event) => onChange('middleInitial', event.target.value)} className={inputClass} /></Field></div>
          <div className="sm:col-span-3"><Field label="Last name"><input required value={form.lastName} onChange={(event) => onChange('lastName', event.target.value)} className={inputClass} /></Field></div>
          <div className="sm:col-span-3"><Field label="Email"><input required type="email" value={form.email} onChange={(event) => onChange('email', event.target.value)} className={inputClass} /></Field></div>
          <div className="sm:col-span-3"><PasswordField label={editing ? 'New password (optional)' : 'Password'} required={!editing} value={form.password} onChange={(event) => onChange('password', event.target.value)} /></div>
          <div className="sm:col-span-3"><PasswordField label={editing ? 'Confirm new password' : 'Confirm password'} disabled={editing && !form.password} required={editing ? Boolean(form.password) : true} value={form.confirmPassword} onChange={(event) => onChange('confirmPassword', event.target.value)} /></div>
          <div className="sm:col-span-3"><Field label="Role"><select disabled={editingSelf} value={form.role} onChange={(event) => onChange('role', event.target.value)} className={`${inputClass} disabled:bg-slate-100 disabled:text-slate-400`}><option value="ADMIN">Admin</option><option value="COLLECTOR">Collector</option><option value="RESIDENT">Resident</option></select></Field></div>
          <div className="flex justify-end gap-3 sm:col-span-6"><button type="button" onClick={onClose} className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-bold text-[var(--ink)]">Cancel</button><button className="rounded-lg bg-[var(--primary)] px-5 py-2.5 text-sm font-bold text-white">{editing ? 'Save changes' : 'Add user'}</button></div>
        </form>
      </section>
    </div>
  )
}
