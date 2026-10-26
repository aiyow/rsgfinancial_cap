import { useEffect, useId, useRef, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import PasswordInput from './PasswordInput'

export default function UnpublishBatchModal({ count, busy, onCancel, onConfirm }) {
  const id = useId()
  const dialog = useRef(null)
  const cancelButton = useRef(null)
  const mounted = useRef(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

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
    function keyDown(event) {
      if (event.key === 'Escape') { if (!busy) onCancel(); return }
      if (event.key !== 'Tab') return
      const controls = [...dialog.current.querySelectorAll('button:not(:disabled),input:not(:disabled)')]
      const first = controls[0], last = controls.at(-1)
      if (!first) event.preventDefault()
      else if (event.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keyDown)
    return () => document.removeEventListener('keydown', keyDown)
  }, [busy, onCancel])

  async function submit(event) {
    event.preventDefault()
    if (busy || !password) return
    setError('')
    try { await onConfirm(password) }
    catch (requestError) {
      if (!mounted.current) return
      setError(requestError.message)
      setPassword('')
      dialog.current.querySelector('input')?.focus()
    }
  }

  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-[1px]" role="presentation" onMouseDown={() => { if (!busy) onCancel() }}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby={id} className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6" onMouseDown={event => event.stopPropagation()}>
      <span className="grid size-11 place-items-center rounded-xl bg-amber-100 text-amber-800"><TriangleAlert size={22} aria-hidden="true" /></span>
      <h2 id={id} className="mt-4 text-xl font-black text-slate-900">Unpublish all SOAs?</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">All <strong>{count}</strong> Statements of Account in this batch will be hidden from residents. You can publish them again later.</p>
      <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">Emails already sent cannot be recalled.</p>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <PasswordInput current label="Your current Admin password" value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button ref={cancelButton} type="button" disabled={busy} onClick={onCancel} className="min-h-11 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50">Cancel</button>
          <button disabled={busy || !password} aria-busy={busy} className="min-h-11 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Unpublishing...' : 'Confirm unpublish all'}</button>
        </div>
      </form>
    </section>
  </div>
}
