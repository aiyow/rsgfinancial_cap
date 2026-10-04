import { currency } from './chargePayments.js'

function validAmount(value) {
  if (value == null || typeof value === 'boolean' || (typeof value === 'string' && !value.trim())) return null
  const amount = Number(value)
  return Number.isFinite(amount) && amount >= 0 ? amount : null
}

export function paymentAmountSummary(payment) {
  const verified = validAmount(payment.verifiedAmount)
  if (payment.reviewStatus === 'APPROVED' && verified !== null) return { label: 'Verified amount', value: currency(verified) }
  const detected = validAmount(payment.ocrAmount)
  if (detected !== null) return { label: 'Detected · unverified', value: currency(detected) }
  return { label: 'Amount', value: payment.reviewStatus === 'REJECTED' ? 'Not verified' : 'Awaiting review' }
}

export function paymentDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila',
  }).format(date)
}

export function paymentMethodLabel(value) {
  return ({ GCASH: 'GCash', BANK_TRANSFER: 'Bank transfer', CASH: 'Cash' })[value] || (value ? String(value).replaceAll('_', ' ') : 'Method not set')
}

export function paymentInvoiceReferences(payment) {
  return [...new Set((payment.allocations || []).map(row => row.invoiceNumber?.trim()).filter(Boolean))]
}
