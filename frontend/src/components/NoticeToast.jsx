import { useEffect, useState } from 'react'
import { CheckCircle2, CircleAlert, X } from 'lucide-react'

export default function NoticeToast({ error = '', message = '' }) {
  const text = error || message
  const [visible, setVisible] = useState(true)
  const isError = Boolean(error)

  useEffect(() => {
    if (!text) return undefined
    const timeout = window.setTimeout(() => setVisible(false), isError ? 7000 : 5000)
    return () => window.clearTimeout(timeout)
  }, [isError, text])

  if (!text || !visible) return null

  const Icon = isError ? CircleAlert : CheckCircle2
  return (
    <div className="print-hidden fixed right-4 top-20 z-50 w-[calc(100%_-_2rem)] max-w-md animate-[toast-enter_180ms_ease-out] sm:right-6" role={isError ? 'alert' : 'status'} aria-live="polite">
      <div className={`flex items-start gap-3 rounded-xl border p-4 shadow-xl ${isError ? 'border-rose-200 bg-rose-50 text-rose-950' : 'border-emerald-200 bg-white text-slate-900'}`}>
        <span className={`grid size-9 shrink-0 place-items-center rounded-full ${isError ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}><Icon size={19} aria-hidden="true" /></span>
        <div className="min-w-0 flex-1"><p className="text-sm font-black">{isError ? 'Something needs attention' : 'Update complete'}</p><p className="mt-0.5 text-sm leading-5 text-slate-600">{text}</p></div>
        <button type="button" onClick={() => setVisible(false)} aria-label="Dismiss notification" className="-mr-1 -mt-1 rounded-lg p-2 text-slate-500 transition hover:bg-black/5 hover:text-slate-900"><X size={17} /></button>
      </div>
    </div>
  )
}
