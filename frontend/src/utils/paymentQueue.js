import { purposeLabels } from './chargePayments.js'
import { paymentMethodLabel } from './paymentHistory.js'

export const defaultPaymentFilters = { search: '', status: 'ALL', purpose: 'ALL', method: 'ALL', source: 'ALL', dateFrom: '', dateTo: '', sort: 'NEWEST' }
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export function paymentQueueAmount(payment) {
  const value = payment.reviewStatus === 'APPROVED' ? payment.verifiedAmount : payment.ocrAmount
  if (value == null || typeof value === 'boolean' || String(value).trim() === '') return null
  const amount = Number(value)
  return Number.isFinite(amount) && amount >= 0 ? amount : null
}

export function paymentReceivedDay(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const part = type => parts.find(row => row.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

const receivedTimestamp = payment => Date.parse(payment.submittedAt) || 0

export function filterPaymentQueue(payments, options = {}) {
  const filters = { ...defaultPaymentFilters, ...options }
  const terms = normalize(filters.search).trim().split(/\s+/).filter(Boolean)
  const rows = payments.filter(payment => {
    if (filters.status !== 'ALL' && payment.reviewStatus !== filters.status) return false
    if (filters.purpose !== 'ALL' && payment.paymentPurpose !== filters.purpose) return false
    if (filters.method !== 'ALL' && payment.paymentMethod !== filters.method) return false
    if (filters.source !== 'ALL' && payment.entryType !== filters.source) return false
    if (filters.dateFrom || filters.dateTo) {
      const day = paymentReceivedDay(payment.submittedAt)
      if (!day || (filters.dateFrom && day < filters.dateFrom) || (filters.dateTo && day > filters.dateTo)) return false
    }
    if (!terms.length) return true
    // Search references and invoices without exposing the full ledger in the list.
    const searchable = normalize([
      payment.submittedByName, `Unit ${payment.unitNumber ?? ''}`, `Payment ${payment.id}`,
      payment.verifiedReferenceNo, payment.ocrReferenceNo, purposeLabels[payment.paymentPurpose],
      paymentMethodLabel(payment.paymentMethod), ...(payment.allocations || []).map(row => row.invoiceNumber),
    ].join(' '))
    return terms.every(term => searchable.includes(term))
  })
  return rows.sort((a, b) => {
    let comparison = 0
    if (filters.sort === 'OLDEST') comparison = receivedTimestamp(a) - receivedTimestamp(b)
    if (filters.sort === 'UNIT') comparison = collator.compare(String(a.unitNumber ?? ''), String(b.unitNumber ?? ''))
    if (filters.sort === 'RESIDENT') comparison = collator.compare(a.submittedByName || '', b.submittedByName || '')
    if (filters.sort === 'PENDING_FIRST') comparison = Number(b.reviewStatus === 'PENDING') - Number(a.reviewStatus === 'PENDING')
    if (filters.sort === 'AMOUNT_HIGH' || filters.sort === 'AMOUNT_LOW') {
      const aAmount = paymentQueueAmount(a), bAmount = paymentQueueAmount(b)
      if (aAmount === null && bAmount !== null) return 1
      if (bAmount === null && aAmount !== null) return -1
      if (aAmount !== null && bAmount !== null) comparison = filters.sort === 'AMOUNT_HIGH' ? bAmount - aAmount : aAmount - bAmount
    }
    return comparison || receivedTimestamp(b) - receivedTimestamp(a) || collator.compare(String(b.id), String(a.id))
  })
}

export function paginatePaymentQueue(rows, requestedPage = 1, pageSize = 10) {
  const size = [10, 25, 50].includes(Number(pageSize)) ? Number(pageSize) : 10
  const pageCount = Math.max(1, Math.ceil(rows.length / size))
  const page = Math.min(pageCount, Math.max(1, Math.floor(Number(requestedPage)) || 1))
  const start = (page - 1) * size
  return { rows: rows.slice(start, start + size), page, pageCount, first: rows.length ? start + 1 : 0, last: Math.min(start + size, rows.length), total: rows.length }
}
