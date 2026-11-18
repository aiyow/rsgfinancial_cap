import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import { formatLabel } from '../utils/formatText'

export default function UnitTenantListModal({ unit, onClose }) {
  const dialogRef = useRef(null)
  const titleId = useId()
  useEffect(() => {
    const element = dialogRef.current
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    element.showModal()
    return () => {
      element.close()
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  return <dialog ref={dialogRef} aria-labelledby={titleId} aria-modal="true"
    onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => { if (event.target === event.currentTarget) onClose() }}
    className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-2xl border border-emerald-100 bg-white p-0 text-slate-800 shadow-2xl backdrop:bg-slate-950/40">
    <header className="flex items-start justify-between gap-4 border-b border-emerald-100 p-5">
      <div><h2 id={titleId} className="text-lg font-black">Unit {unit.unitNumber} — Tenant(s)</h2><p className="mt-1 text-sm text-slate-500">{unit.currentResidents.length} people currently listed for this unit.</p></div>
      <button type="button" onClick={onClose} aria-label="Close tenant list" className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-emerald-50 focus-visible:ring-2 focus-visible:ring-emerald-600"><X size={20} /></button>
    </header>
    <ul className="divide-y divide-emerald-100">{unit.currentResidents.map(assignment => <li key={assignment.id} className="px-5 py-4">
      <p className="break-words font-bold">{assignment.residentName}</p>
      <p className="mt-1 text-xs text-slate-500">{formatLabel(assignment.relationshipType)}</p>
    </li>)}</ul>
  </dialog>
}
