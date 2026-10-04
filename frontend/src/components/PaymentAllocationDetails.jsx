import { currency, purposeLabels } from '../utils/chargePayments'

export default function PaymentAllocationDetails({ payment }) {
  return <div className="space-y-1 text-xs text-slate-600">
    <p className="font-bold">{purposeLabels[payment.paymentPurpose] || 'Purpose unavailable'}</p>
    <p className="break-all">Transaction: {payment.verifiedReferenceNo || payment.ocrReferenceNo || '—'}</p>
    {(payment.allocations || []).map(row => <p key={row.chargeType} className="break-words">{purposeLabels[row.chargeType]}: {currency(row.allocatedAmount)} · Applied {currency(row.appliedAmount)} · Advance {currency(Number(row.allocatedAmount) - Number(row.appliedAmount))} · Invoice {row.invoiceNumber || '—'}</p>)}
  </div>
}
