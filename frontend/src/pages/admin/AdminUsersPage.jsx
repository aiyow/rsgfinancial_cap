import { useCallback, useEffect, useState } from 'react'
import DashboardLayout, { EmptyRow, Panel } from '../../components/DashboardLayout'
import useAuth from '../../hooks/useAuth'
import { apiRequest } from '../../services/api'

const blankUser = { fullName: '', email: '', password: '', role: 'RESIDENT' }
const inputClass = 'mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal'
const actionClass = 'rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50'

function Field({ label, children }) {
  return <label className="block text-xs font-bold text-slate-600">{label}{children}</label>
}

export default function AdminUsersPage() {
  const { token, user: currentUser } = useAuth()
  const [users, setUsers] = useState([])
  const [form, setForm] = useState(blankUser)
  const [editingId, setEditingId] = useState(null)
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

  async function saveUser(event) {
    event.preventDefault()
    const body = editingId && !form.password ? { fullName: form.fullName, email: form.email, role: form.role } : form
    const saved = await runAction(
      () => apiRequest(editingId ? `/api/users/${editingId}` : '/api/users', { method: editingId ? 'PATCH' : 'POST', token, body }),
      editingId ? 'User updated.' : 'User created.',
    )
    if (saved) cancelEdit()
  }

  function startEdit(user) {
    setEditingId(user.id)
    setForm({ fullName: user.fullName, email: user.email, password: '', role: user.role })
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(blankUser)
  }

  return (
    <DashboardLayout title="User management" description="Manage Admin, Collector, and Resident accounts.">
      {(notice.error || notice.message) && <p className={`rounded-lg p-3 text-sm ${notice.error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{notice.error || notice.message}</p>}
      <Panel title="Users" description="Create accounts, change their status, or delete an incorrect account.">
        <form onSubmit={saveUser} className="grid gap-3 rounded-xl bg-slate-50 p-4 md:grid-cols-5">
          <Field label="Full name"><input required value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} className={inputClass} /></Field>
          <Field label="Email"><input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className={inputClass} /></Field>
          <Field label={editingId ? 'New password (optional)' : 'Password'}><input required={!editingId} minLength="8" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className={inputClass} /></Field>
          <Field label="Role"><select disabled={editingSelf} value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} className={`${inputClass} disabled:bg-slate-100 disabled:text-slate-400`}><option value="ADMIN">Admin</option><option value="COLLECTOR">Collector</option><option value="RESIDENT">Resident</option></select></Field>
          <div className="flex self-end gap-2"><button className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white">{editingId ? 'Save' : 'Add user'}</button>{editingId && <button type="button" onClick={cancelEdit} className={actionClass}>Cancel</button>}</div>
        </form>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-400"><tr><th className="pb-3">Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="py-3 font-bold">{user.fullName}</td><td>{user.email}</td><td>{user.role}</td><td>{user.isActive ? 'Active' : 'Inactive'}</td>
                  <td className="space-x-2">
                    <button className={actionClass} onClick={() => startEdit(user)}>Edit</button>
                    {Number(user.id) !== Number(currentUser.id) && <button className={actionClass} onClick={() => runAction(() => apiRequest(`/api/users/${user.id}`, { method: 'PATCH', token, body: { isActive: !user.isActive } }), 'User updated.')}>{user.isActive ? 'Deactivate' : 'Activate'}</button>}
                    {Number(user.id) !== Number(currentUser.id) && <button className={`${actionClass} text-red-600`} onClick={() => window.confirm('Permanently delete this user and their unit assignment records?') && runAction(() => apiRequest(`/api/users/${user.id}`, { method: 'DELETE', token }), 'User deleted.')}>Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && <EmptyRow message="No users found." />}
        </div>
      </Panel>
    </DashboardLayout>
  )
}
