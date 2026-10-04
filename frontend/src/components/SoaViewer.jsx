import { useEffect, useRef, useState } from 'react'
import { Expand, Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react'
import SoaDocument from './SoaDocument'

const DOCUMENT_WIDTH = 1040
const MIN_ZOOM = 0.1
const MAX_ZOOM = 2
const controlClass = 'grid size-11 shrink-0 place-items-center rounded-lg border border-emerald-200 bg-white text-emerald-800 transition hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-40'

export default function SoaViewer({ bill }) {
  const viewerRef = useRef(null)
  const viewportRef = useRef(null)
  const documentRef = useRef(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0, availableHeight: 0 })
  // null follows the available width; manual zoom stays fixed when rotating.
  const [manualZoom, setManualZoom] = useState(null)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    const viewport = viewportRef.current
    const document = documentRef.current
    function measure() {
      const maxHeight = Number.parseFloat(window.getComputedStyle(viewport).maxHeight)
      const next = { width: Math.max(1, viewport.clientWidth - 16), height: document.offsetHeight, availableHeight: Math.max(1, (Number.isFinite(maxHeight) ? maxHeight : viewport.clientHeight) - 16) }
      setDimensions((current) => current.width === next.width && current.height === next.height && current.availableHeight === next.availableHeight ? current : next)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    observer.observe(document)
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [])

  useEffect(() => {
    if (!fullscreen) return undefined
    const viewer = viewerRef.current
    const previouslyFocused = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    viewer.querySelector('[aria-label="Close full screen statement"]')?.focus()
    function handleKeyDown(event) {
      if (event.key === 'Escape') { setFullscreen(false); setManualZoom(null) }
      if (event.key !== 'Tab') return
      const controls = [...viewer.querySelectorAll('button:not(:disabled), [tabindex="0"]')]
      const first = controls[0]
      const last = controls.at(-1)
      if (event.shiftKey && (document.activeElement === first || !viewer.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !viewer.contains(document.activeElement))) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [fullscreen])

  const fitZoom = Math.min(1, dimensions.width / DOCUMENT_WIDTH, dimensions.height ? dimensions.availableHeight / dimensions.height : 1)
  const zoom = manualZoom ?? fitZoom
  const ready = dimensions.width > 0 && dimensions.height > 0

  function changeZoom(direction) {
    setManualZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((zoom + direction * 0.1).toFixed(3)))))
  }

  function fitToScreen() {
    setManualZoom(null)
    viewportRef.current?.scrollTo({ top: 0, left: 0 })
  }

  return (
    <section ref={viewerRef} className={`soa-viewer min-w-0 overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-sm ${fullscreen ? 'soa-viewer-fullscreen' : ''}`} role={fullscreen ? 'dialog' : undefined} aria-modal={fullscreen ? true : undefined} aria-label="Statement of account viewer">
      <div className="print-hidden flex flex-wrap items-center justify-between gap-2 border-b border-emerald-100 px-3 py-2">
        <h2 className="text-sm font-black text-slate-950">Statement of account</h2>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => changeZoom(-1)} disabled={!ready || zoom <= MIN_ZOOM} className={controlClass} aria-label="Zoom out statement" title="Zoom out"><ZoomOut size={17} aria-hidden="true" /></button>
          <output className="min-w-10 text-center text-xs font-semibold tabular-nums text-slate-600" aria-label="Statement zoom" aria-live="polite">{ready ? `${Math.round(zoom * 100)}%` : '—'}</output>
          <button type="button" onClick={() => changeZoom(1)} disabled={!ready || zoom >= MAX_ZOOM} className={controlClass} aria-label="Zoom in statement" title="Zoom in"><ZoomIn size={17} aria-hidden="true" /></button>
          <button type="button" onClick={fitToScreen} disabled={!ready} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-2.5 text-xs font-bold text-emerald-800 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600" aria-label="Fit full statement to screen" title="Fit to screen"><Maximize2 size={15} aria-hidden="true" />Fit</button>
          <button type="button" onClick={() => { setManualZoom(null); setFullscreen((current) => !current) }} className={controlClass} aria-label={fullscreen ? 'Close full screen statement' : 'Open full screen statement'} title={fullscreen ? 'Close full screen' : 'Full screen'}>{fullscreen ? <X size={18} aria-hidden="true" /> : <Expand size={17} aria-hidden="true" />}</button>
        </div>
      </div>
      <div ref={viewportRef} className="soa-viewer-viewport" role="region" aria-label="Scrollable statement. Zoom in for details, then swipe or scroll to move." tabIndex={0}>
        <div className="soa-viewer-canvas" style={{ width: DOCUMENT_WIDTH * zoom, height: dimensions.height * zoom, visibility: ready ? 'visible' : 'hidden' }}>
          <div ref={documentRef} className="soa-viewer-document" style={{ width: DOCUMENT_WIDTH, transform: `scale(${zoom})` }}>
            <SoaDocument bill={bill} />
          </div>
        </div>
      </div>
      <p className="print-hidden border-t border-emerald-100 px-3 py-2 text-[11px] text-slate-500">Fit shows the complete SOA. Zoom in, then swipe to read details.</p>
    </section>
  )
}
