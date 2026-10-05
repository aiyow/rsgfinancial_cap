import { ArrowDown, ReceiptText } from 'lucide-react'

export default function InvoiceSectionButton({ targetRef }) {
  function goToInvoices() {
    const target = targetRef.current
    if (!target) return
    target.focus({ preventScroll: true })
    target.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    })
  }

  return <button type="button" onClick={goToInvoices} aria-controls="soa-invoice-numbers" className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-800 transition hover:border-emerald-600 hover:bg-emerald-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">
    <ReceiptText size={17} aria-hidden="true" />
    Invoice Numbers
    <ArrowDown size={15} aria-hidden="true" />
  </button>
}
