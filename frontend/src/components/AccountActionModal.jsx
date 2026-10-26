import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { LoaderCircle, TriangleAlert } from 'lucide-react'
import useAuth from '../hooks/useAuth'
import { apiRequest } from '../services/api'
import PasswordInput from './PasswordInput'

const secondary = 'min-h-11 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50'

export default function AccountActionModal({ action, user, onCancel, onConfirm }) {
  const { token } = useAuth()
  const id = useId()
  const dialog = useRef(null)
  const cancelButton = useRef(null)
  const mounted = useRef(false)
  const [revision, setRevision] = useState(0)
  const [check, setCheck] = useState({ loading: true, data: null, error: '' })
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [mutationError, setMutationError] = useState('')
  const deleting = action === 'delete'
  const allowed = check.data?.[deleting ? 'canDelete' : 'canDeactivate'] === true
  const reason = check.data?.[deleting ? 'deleteBlockReason' : 'deactivationBlockReason']
  const unpaidUnits = [...new Set((check.data?.unpaidSOAs || []).map(bill => bill.unitNumber))]
  const blockMessage = !deleting && unpaidUnits.length ? 'Settle unpaid bills before deactivating this account.' : reason || 'This action is not currently allowed.'
  const disabled = busy || check.loading || Boolean(check.error) || !allowed
  const requiresPassword = deleting && (check.data?.requiresPasswordForDelete ?? ['ADMIN', 'COLLECTOR'].includes(user.role))

  useEffect(() => {
    mounted.current = true
    const previousFocus = document.activeElement
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    cancelButton.current?.focus()
    return () => {
      mounted.current = false
      document.body.style.overflow = overflow
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    apiRequest(`/api/users/${user.id}/action-eligibility`, { token, signal: controller.signal })
      .then(data => {
        if (typeof data.canDelete !== 'boolean' || typeof data.canDeactivate !== 'boolean'
          || !Array.isArray(data.activeAssignments) || !Array.isArray(data.unpaidSOAs)) throw new Error('Unable to verify account eligibility. Please retry.')
        if (active) setCheck({ loading: false, data, error: '' })
      })
      .catch(error => { if (active) setCheck({ loading: false, data: null, error: error.message }) })
    return () => { active = false; controller.abort() }
  }, [revision, token, user.id])

  useEffect(() => {
    function keyDown(event) {
      if (event.key === 'Escape') { if (!busy) onCancel(); return }
      if (event.key !== 'Tab') return
      const controls = [...dialog.current.querySelectorAll('button:not(:disabled),input:not(:disabled),a[href]')]
      const first = controls[0]
      const last = controls.at(-1)
      if (!controls.length) event.preventDefault()
      else if (event.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keyDown)
    return () => document.removeEventListener('keydown', keyDown)
  }, [busy, onCancel])

  function reload() {
    setCheck({ loading: true, data: null, error: '' })
    setRevision(value => value + 1)
  }

  async function submit(event) {
    event.preventDefault()
    if (disabled) return
    setBusy(true)
    setMutationError('')
    try { await onConfirm(requiresPassword ? password : '') }
    catch (error) {
      if (!mounted.current) return
      setMutationError(error.message)
      if (error.status === 409) reload()
    } finally { if (mounted.current) setBusy(false) }
  }

  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-[1px]" role="presentation" onMouseDown={() => { if (!busy) onCancel() }}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby={id} className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6" onMouseDown={event => event.stopPropagation()}>
      <div className="flex items-start gap-3">
        <span className={`grid size-10 shrink-0 place-items-center rounded-full ${deleting ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}><TriangleAlert size={21} aria-hidden="true" /></span>
        <div><h2 id={id} className="text-xl font-black text-slate-900">{deleting ? 'Delete this account?' : 'Deactivate this account?'}</h2><p className="mt-1 text-sm text-slate-600">{deleting ? 'This cannot be undone.' : 'The user will no longer be able to sign in.'}</p></div>
      </div>
      <p className="mt-5 text-sm text-slate-700">{deleting ? 'Permanently delete' : 'Deactivate'} <strong>{user.fullName}</strong>?</p>
      <div className="mt-4 space-y-3">
        {check.loading && <p role="status" className="flex items-center gap-2 text-sm text-slate-600"><LoaderCircle size={17} className="animate-spin" aria-hidden="true" />Checking unit assignments and published SOAs…</p>}
        {check.error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><p>{check.error}</p><button type="button" disabled={busy} onClick={reload} className={`${secondary} mt-3 bg-white`}>Retry eligibility check</button></div>}
        {check.data && !allowed && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p role="alert" className="font-semibold">{blockMessage}</p>
          {deleting && check.data.activeAssignments.length > 0 && <><ul className="mt-3 space-y-2">{check.data.activeAssignments.map(assignment => <li key={assignment.assignmentId} className="rounded-lg border border-amber-100 bg-white p-2.5"><span className="font-bold">Unit {assignment.unitNumber}</span><span className="ml-2 text-xs capitalize">{assignment.relationshipType.toLowerCase()}</span></li>)}</ul><Link to="/admin/units/manage" className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-amber-300 bg-white px-3 font-bold">Manage unit assignments</Link></>}
          {!deleting && unpaidUnits.length > 0 && <><ul aria-label="Units with unpaid bills" className="mt-3 flex max-h-40 flex-wrap gap-2 overflow-y-auto">{unpaidUnits.map(unit => <li key={unit} className="rounded-lg border border-amber-100 bg-white px-3 py-2 font-bold">Unit {unit}</li>)}</ul><p className="mt-3 text-xs">Pending payments need approval.</p></>}
        </div>}
        {check.data && allowed && <p className={`rounded-xl border p-3 text-sm ${deleting ? 'border-rose-100 bg-rose-50 text-rose-900' : 'border-emerald-100 bg-emerald-50 text-emerald-900'}`}>{deleting ? 'Their ended assignment history and any billing-error reports they submitted will also be permanently removed.' : 'Their records and unit assignments will be retained. You can reactivate the account later.'}</p>}
        {mutationError && mutationError !== reason && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{mutationError}</p>}
      </div>
      <form onSubmit={submit} className="mt-5 space-y-4">
        {requiresPassword && allowed && !check.loading && <><p className="text-sm text-slate-600">Enter your current Admin password to delete this privileged account.</p><PasswordInput current disabled={busy} label="Your current password" value={password} onChange={event => setPassword(event.target.value)} /></>}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button ref={cancelButton} type="button" disabled={busy} onClick={onCancel} className={secondary}>{deleting ? 'Keep account' : 'Keep active'}</button><button disabled={disabled} aria-busy={busy} className={`min-h-11 rounded-lg px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 ${deleting ? 'bg-rose-600 hover:bg-rose-700' : 'bg-amber-600 hover:bg-amber-700'}`}>{busy ? deleting ? 'Deleting...' : 'Deactivating...' : deleting ? 'Delete permanently' : 'Deactivate account'}</button></div>
      </form>
    </section>
  </div>
}
