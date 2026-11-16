import { useEffect, useRef, useSyncExternalStore } from 'react'
import { Check, Download, X } from 'lucide-react'
import { dismissInstall, getInstallState, isIosInstall, openInstall, requestInstall, subscribeInstall, supportsInstall } from '../services/pwaInstall'

function InstallDialog({ state }) {
  const dialog = useRef(null)
  const busy = useRef(state.busy)
  useEffect(() => { busy.current = state.busy }, [state.busy])
  useEffect(() => {
    const previous = document.activeElement
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const element = dialog.current
    element.querySelector('button')?.focus()
    function keydown(event) {
      if (event.key === 'Escape' && !busy.current) { event.preventDefault(); dismissInstall() }
      if (event.key !== 'Tab') return
      const buttons = [...element.querySelectorAll('button:not(:disabled)')]
      if (!buttons.length) { event.preventDefault(); return }
      const first = buttons[0], last = buttons.at(-1)
      if (event.shiftKey && (document.activeElement === first || !element.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !element.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keydown); previous?.focus?.() }
  }, [])

  return <div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm" onClick={event => { if (event.target === event.currentTarget && !state.busy) dismissInstall() }}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="pwa-install-title" aria-describedby="pwa-install-description" className="relative max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6 text-center shadow-2xl sm:p-8">
      <button type="button" onClick={dismissInstall} disabled={state.busy} aria-label="Close install prompt" className="absolute right-3 top-3 rounded-full p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X size={20} /></button>
      <img src="/icons/pwa-192.png" alt="" className="mx-auto size-16 rounded-2xl shadow-lg" />
      <p className="mt-4 text-sm font-bold text-emerald-700">The ResiDens Financial Platform</p>
      <h2 id="pwa-install-title" className="mt-2 text-2xl font-black text-slate-900">Install The ResiDens app?</h2>
      <p id="pwa-install-description" className="mt-3 text-sm leading-6 text-slate-600">Add The ResiDens to your device for quick access to your condominium portal.</p>
      {state.prompt || state.busy ? <ul className="mt-5 space-y-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-left text-sm text-slate-700">{['Open directly from your home screen or desktop', 'Use a dedicated app window', 'Access your bills, payments, and water usage'].map(text => <li key={text} className="flex gap-2"><Check size={18} className="shrink-0 text-emerald-600" aria-hidden="true" />{text}</li>)}</ul>
        : <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-left text-sm leading-6 text-slate-700"><p className="font-bold text-emerald-900">How to install</p>{isIosInstall
          ? <ol className="mt-2 list-decimal space-y-2 pl-5"><li>Open this website in Safari.</li><li>Tap the <strong>Share</strong> button, then <strong>Add to Home Screen</strong>.</li><li>Tap <strong>Add</strong> to finish.</li></ol>
          : <p className="mt-2">Open your browser menu and look for <strong>Install app</strong> or <strong>Add to Home Screen</strong>. If these options are missing, try opening this site in Chrome or Edge. The browser decides when installation is available.</p>}</div>}
      {state.error && <p role="alert" className="mt-3 text-sm text-rose-700">{state.error}</p>}
      <div className="mt-6 flex gap-3"><button type="button" disabled={state.busy} onClick={dismissInstall} className="min-h-11 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Not now</button>{state.prompt || state.busy
        ? <button type="button" disabled={state.busy} onClick={requestInstall} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white shadow-md hover:bg-emerald-800 disabled:opacity-50"><Download size={18} />{state.busy ? 'Installing…' : 'Install'}</button>
        : <button type="button" onClick={dismissInstall} className="min-h-11 flex-1 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-800">Got it</button>}</div>
    </section>
  </div>
}

export default function PwaInstallPrompt() {
  const state = useSyncExternalStore(subscribeInstall, getInstallState)
  if (!supportsInstall || state.installed) return null
  const open = state.manual || (!state.dismissed && (state.prompt || isIosInstall))
  return <><button type="button" onClick={openInstall} className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-emerald-800 hover:bg-emerald-50"><Download size={17} aria-hidden="true" />Install The ResiDens app</button>{open && <InstallDialog state={state} />}</>
}
