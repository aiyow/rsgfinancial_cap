import { useEffect, useId, useRef } from 'react'
import { ArrowRight } from 'lucide-react'

export default function PaymentSubmittedModal({ unitNumber, purpose, onContinue }) {
  const titleId = useId()
  const detailsId = useId()
  const button = useRef(null)

  useEffect(() => {
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    button.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  function keyDown(event) {
    if (event.key === 'Tab') {
      event.preventDefault()
      button.current?.focus()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      onContinue()
    }
  }

  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm" onKeyDown={keyDown}>
    <section role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={detailsId}
      className="payment-submitted-card relative max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-2xl border border-emerald-100 bg-white px-6 py-7 text-center shadow-2xl sm:px-8 sm:py-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
        {Array.from({ length: 8 }, (_, index) => <span key={index} className="payment-submitted-confetti"
          style={{ left: `${(index + 1) * 11}%`, backgroundColor: ['#34d399', '#fbbf24', '#60a5fa', '#a78bfa'][index % 4], animationDelay: `${index % 3 * 80}ms` }} />)}
      </div>
      <svg aria-hidden="true" viewBox="0 0 64 64" className="payment-submitted-icon mx-auto size-16 text-emerald-600">
        <circle cx="32" cy="32" r="30" fill="#ecfdf5" />
        <circle cx="32" cy="32" r="23" fill="currentColor" />
        <path className="payment-submitted-check" d="m21 32 7 7 15-15" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <h2 id={titleId} className="mt-4 text-2xl font-black tracking-tight text-slate-950">Payment Submitted</h2>
      <p id={detailsId} className="mt-3 text-sm leading-6 text-slate-600">
        Your receipt{unitNumber ? ` for Unit ${unitNumber}` : ''} has been sent for Admin review. Check Payment History for updates.
      </p>
      {purpose && <p className="mt-3 text-xs font-semibold text-emerald-800">{purpose}</p>}
      <p className="mt-3 inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">Awaiting Admin review</p>
      <button ref={button} type="button" onClick={onContinue}
        className="mt-6 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">
        View Payment History <ArrowRight size={16} aria-hidden="true" />
      </button>
    </section>
  </div>
}
