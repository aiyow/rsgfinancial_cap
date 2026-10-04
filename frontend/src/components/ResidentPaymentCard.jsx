import { Link } from 'react-router-dom'
import { ArrowUpRight, ChevronDown } from 'lucide-react'
import PaymentAllocationDetails from './PaymentAllocationDetails'
import { currency, purposeLabels } from '../utils/chargePayments'
import { paymentAmountSummary, paymentDateTime, paymentInvoiceReferences, paymentMethodLabel } from '../utils/paymentHistory'

export default function ResidentPaymentCard({ payment }) {
  const amount = paymentAmountSummary(payment)
  const invoices = paymentInvoiceReferences(payment)
  const approved = payment.reviewStatus === 'APPROVED'
  const statusStyle = approved ? 'bg-emerald-100 text-emerald-800' : payment.reviewStatus === 'REJECTED' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'

  return <article className="min-w-0 overflow-hidden rounded-xl border border-emerald-100 bg-white shadow-sm" aria-labelledby={`payment-${payment.id}-heading`}>
    <div className="px-3.5 py-3 sm:px-4">
      <div className="flex items-center justify-between gap-2">
        <h3 id={`payment-${payment.id}-heading`} className="min-w-0 break-words text-sm font-black text-slate-950 sm:text-base">Unit {payment.unitNumber}</h3>
        <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${statusStyle}`}>{payment.reviewStatus}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-x-3 gap-y-1.5">
        <div><p className="text-[10px] font-medium text-slate-500 sm:text-[11px]">{amount.label}</p><p className="mt-0.5 break-words text-xl font-black tracking-tight tabular-nums text-slate-950">{amount.value}</p></div>
        <p className="max-w-40 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-semibold leading-4 text-emerald-900">{purposeLabels[payment.paymentPurpose] || 'Purpose unavailable'}</p>
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-[11px] leading-5 text-slate-500"><time dateTime={payment.submittedAt || undefined}>{paymentDateTime(payment.submittedAt)}</time><span aria-hidden="true">·</span><span>{paymentMethodLabel(payment.paymentMethod)}</span></p>
      {approved && <p className="mt-1 text-[11px] leading-5 text-slate-600">Applied {currency(payment.appliedAmount)}{Number(payment.unappliedAmount) > 0 && <> · Payment advance {currency(payment.unappliedAmount)}</>}</p>}
      {invoices.length > 0 && <p className="truncate text-[11px] leading-5 text-slate-600" title={invoices.join(', ')}>Invoice {invoices[0]}{invoices.length > 1 ? ` +${invoices.length - 1} more` : ''}</p>}
      {payment.reviewStatus === 'REJECTED' && payment.remarks && <p className="mt-2 line-clamp-2 text-xs leading-5 text-rose-700">{payment.remarks}</p>}
    </div>
    <div className="relative border-t border-emerald-100">
      <details className="group">
        <summary className="flex min-h-11 w-fit min-w-28 cursor-pointer list-none items-center gap-1.5 rounded-lg px-3.5 text-xs font-bold text-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-emerald-600 [&::-webkit-details-marker]:hidden" aria-label={`Payment details for Unit ${payment.unitNumber}, submission ${payment.id}`}>Details <ChevronDown size={15} className="transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" /></summary>
        <div className="space-y-3 border-t border-emerald-100 bg-slate-50/60 px-3.5 py-3 sm:px-4">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3">
            <PaymentDetail label="OCR amount" value={payment.ocrAmount == null || payment.ocrAmount === '' ? 'Not detected' : currency(payment.ocrAmount)} />
            <PaymentDetail label="Applied amount" value={currency(payment.appliedAmount)} />
            <PaymentDetail label="Unit advance" value={currency(payment.unitAdvanceBalance)} />
            {payment.targetBillId && <PaymentDetail label="Overall SOA balance" value={currency(payment.remainingBalance)} />}
            <PaymentDetail label="Payment date" value={payment.verifiedPaymentDate || payment.ocrPaymentDate || '—'} />
            <PaymentDetail label="Reviewed" value={paymentDateTime(payment.reviewedAt)} />
          </dl>
          <div className="border-t border-emerald-100 pt-3"><PaymentAllocationDetails payment={payment} /></div>
          {payment.remarks && <p className="break-words text-xs leading-5 text-slate-600"><span className="font-bold">Review note: </span>{payment.remarks}</p>}
        </div>
      </details>
      {payment.targetBillId && <Link to={`/resident/bills/${payment.targetBillId}`} className="absolute right-1 top-0 inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-xs font-bold text-emerald-800 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-emerald-600" aria-label={`Open SOA for Unit ${payment.unitNumber}, payment ${payment.id}`}>Open SOA <ArrowUpRight size={14} aria-hidden="true" /></Link>}
    </div>
  </article>
}

function PaymentDetail({ label, value }) {
  return <div className="min-w-0"><dt className="text-[10px] font-medium text-slate-500 sm:text-xs">{label}</dt><dd className="mt-0.5 break-words text-xs font-semibold tabular-nums text-slate-900 [overflow-wrap:anywhere]">{value}</dd></div>
}
