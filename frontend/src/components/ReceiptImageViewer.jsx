import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Download, RotateCcw, Share2, ZoomIn, ZoomOut } from 'lucide-react'

const MIN_ZOOM = 0.75
const MAX_ZOOM = 2.5
const controlClass = 'grid size-9 shrink-0 place-items-center rounded-md text-slate-700 transition hover:bg-slate-100 hover:text-emerald-700 focus-visible:outline-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-40'

export default function ReceiptImageViewer({ src, onDownload, onShare }) {
  const viewportRef = useRef(null)
  const pan = useRef(null)
  const zoomAnchor = useRef(null)
  const [natural, setNatural] = useState({ width: 0, height: 0 })
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [dragging, setDragging] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const element = viewportRef.current
    const observer = new ResizeObserver(() => {
      const next = { width: element.clientWidth, height: element.clientHeight }
      setViewport(current => current.width === next.width && current.height === next.height ? current : next)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const ready = natural.width > 0 && natural.height > 0 && viewport.width > 0 && viewport.height > 0
  const fitScale = ready ? Math.min(1, Math.max(1, viewport.width - 24) / natural.width, Math.max(1, viewport.height - 24) / natural.height) : 0
  const width = natural.width * fitScale * zoom
  const height = natural.height * fitScale * zoom
  // A sized canvas keeps every edge at a nonnegative scroll coordinate. Scaling
  // a centered image with CSS transforms leaves its top/left edges unreachable.
  const canvasWidth = Math.max(viewport.width, Math.ceil(width + 24))
  const canvasHeight = Math.max(viewport.height, Math.ceil(height + 24))
  const left = (canvasWidth - width) / 2
  const top = (canvasHeight - height) / 2
  const scrollable = canvasWidth > viewport.width || canvasHeight > viewport.height

  useLayoutEffect(() => {
    if (!zoomAnchor.current) return
    const element = viewportRef.current
    const anchor = zoomAnchor.current
    zoomAnchor.current = null
    element.scrollLeft = left + width * anchor.x - element.clientWidth / 2
    element.scrollTop = top + height * anchor.y - element.clientHeight / 2
  }, [left, top, width, height])

  function changeZoom(next, reset = false) {
    const element = viewportRef.current
    zoomAnchor.current = reset ? { x: 0.5, y: 0.5 } : {
      x: Math.max(0, Math.min(1, (element.scrollLeft + element.clientWidth / 2 - left) / width)),
      y: Math.max(0, Math.min(1, (element.scrollTop + element.clientHeight / 2 - top) / height)),
    }
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(next.toFixed(2)))))
  }

  function startPan(event) {
    // Touch uses the browser's native two-axis scrolling and inertia.
    if (event.pointerType === 'touch' || event.button !== 0 || !scrollable || event.target === event.currentTarget) return
    const element = event.currentTarget
    pan.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop }
    element.setPointerCapture(event.pointerId)
    setDragging(true)
    element.focus({ preventScroll: true })
    event.preventDefault()
  }

  function movePan(event) {
    if (pan.current?.id !== event.pointerId) return
    event.currentTarget.scrollLeft = pan.current.left - (event.clientX - pan.current.x)
    event.currentTarget.scrollTop = pan.current.top - (event.clientY - pan.current.y)
  }

  function endPan(event) {
    if (pan.current?.id !== event.pointerId) return
    pan.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return <section aria-label="Receipt viewer" className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
    <div role="toolbar" aria-label="Receipt image controls" className="flex flex-wrap items-center justify-end gap-1.5 border-b border-slate-200 bg-white p-2">
      <button type="button" onClick={() => changeZoom(zoom - 0.25)} disabled={!ready || zoom <= MIN_ZOOM} aria-label="Zoom out receipt" title="Zoom out" className={controlClass}><ZoomOut size={18} aria-hidden="true" /></button>
      <output aria-label="Receipt zoom" aria-live="polite" className="min-w-10 text-center text-xs font-semibold tabular-nums text-slate-600">{Math.round(zoom * 100)}%</output>
      <button type="button" onClick={() => changeZoom(zoom + 0.25)} disabled={!ready || zoom >= MAX_ZOOM} aria-label="Zoom in receipt" title="Zoom in" className={controlClass}><ZoomIn size={18} aria-hidden="true" /></button>
      {zoom !== 1 && <button type="button" onClick={() => changeZoom(1, true)} aria-label="Reset receipt zoom" title="Reset zoom" className={controlClass}><RotateCcw size={17} aria-hidden="true" /></button>}
      <button type="button" onClick={onDownload} aria-label="Download receipt image" title="Download receipt image" className={controlClass}><Download size={18} aria-hidden="true" /></button>
      <button type="button" onClick={onShare} aria-label="Share receipt image" title="Share receipt image" className={controlClass}><Share2 size={18} aria-hidden="true" /></button>
    </div>
    <div ref={viewportRef} role="region" aria-label="Scrollable receipt image. Drag, scroll or swipe to move." tabIndex={0}
      className="h-[min(65dvh,440px)] min-h-56 w-full overflow-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600"
      style={{ cursor: dragging ? 'grabbing' : scrollable ? 'grab' : 'auto', touchAction: 'pan-x pan-y' }}
      onPointerDown={startPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan} onLostPointerCapture={endPan}>
      <div className="relative select-none" style={{ width: canvasWidth, height: canvasHeight }}>
        {!ready && <p role="status" className="p-4 text-sm text-slate-600">{failed ? 'Receipt image could not be displayed. You can still download it.' : 'Loading receipt image...'}</p>}
        <img src={src} alt="Uploaded payment receipt" draggable={false}
          onLoad={event => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          onError={() => setFailed(true)}
          className="absolute block max-w-none"
          style={{ left, top, width, height, maxHeight: 'none', visibility: ready ? 'visible' : 'hidden' }} />
      </div>
    </div>
  </section>
}
