import { useState } from 'react'
import ReceiptImageViewer from './ReceiptImageViewer'

export default function ReceiptGallery({ images, onDownload, onShare }) {
  const [selectedImage, setSelectedImage] = useState(null)
  const activeIndex = Math.max(0, images.indexOf(selectedImage))
  const current = images[activeIndex]
  if (!current) return <p className="mt-3 text-sm text-slate-500">Choose one or two images of the same payment to preview them here.</p>
  return <div className="min-w-0 space-y-2">
    {images.length > 1 && <nav aria-label="Receipt image pages" className="flex items-center justify-center gap-3 rounded-lg border border-emerald-100 bg-white p-2 text-sm">
      <button type="button" disabled={activeIndex === 0} onClick={() => setSelectedImage(images[activeIndex - 1])} className="min-h-10 rounded-md border border-emerald-200 px-3 font-semibold text-emerald-800 disabled:opacity-40">Prev</button>
      <output aria-live="polite" aria-label="Receipt image page" className="min-w-12 text-center tabular-nums">{activeIndex + 1} of {images.length}</output>
      <button type="button" disabled={activeIndex === images.length - 1} onClick={() => setSelectedImage(images[activeIndex + 1])} className="min-h-10 rounded-md border border-emerald-200 px-3 font-semibold text-emerald-800 disabled:opacity-40">Next</button>
    </nav>}
    {current.src ? <ReceiptImageViewer key={current.src} src={current.src}
      onDownload={onDownload ? () => onDownload(current, activeIndex) : undefined}
      onShare={onShare ? () => onShare(current, activeIndex) : undefined} />
      : <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">This receipt image could not be loaded. Please reopen the payment to try again.</p>}
  </div>
}
