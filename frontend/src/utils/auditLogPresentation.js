export const entityLabels = { USER_ACCOUNT: 'User account', UNIT: 'Unit', UNIT_ASSIGNMENT: 'Unit assignment', BILLING_PERIOD: 'Billing batch', UNIT_BILL: 'SOA', PAYMENT_SUBMISSION: 'Payment', BILLING_ERROR_REPORT: 'Billing error report', SOA_TEMPLATE: 'SOA template', SOA_EMAIL_DELIVERY: 'SOA email', ANALYTICS_IMPORT: 'Analytics import', ANALYTICS: 'Water analytics', PRESCRIPTIVE_RECOMMENDATION: 'Recommendation', METER_READING: 'Meter reading' }
export const actionLabels = { CREATE: 'Created', REGISTER: 'Registered', CREATE_MANUAL: 'Recorded', UPDATE: 'Updated', DELETE: 'Deleted', DELETED: 'Deleted', END: 'Ended', SUBMIT: 'Submitted', APPROVE: 'Approved', REJECT: 'Rejected', GENERATED: 'Generated', REOPENED: 'Reopened', FORWARDED: 'Forwarded', PUBLISHED: 'Published', UNPUBLISHED: 'Unpublished', SOA_EDITED: 'Corrected', SOA_EDITED_FROM_BILLING_ERROR: 'Corrected from a resident report', IMPORT_READINGS: 'Imported readings for', CORRECT_READINGS: 'Corrected readings for', IMPORT: 'Imported', REPLACE_IMPORT: 'Replaced', CLEAR_IMPORTS: 'Cleared', REFRESH_FORECASTS: 'Refreshed', EDIT_INVOICES: 'Updated invoices for', PAYMENT_REFERENCES_UPDATED: 'Updated payment references for', UPDATE_PROFILE: 'Updated profile for', CHANGE_EMAIL: 'Changed email for', PASSWORD_CHANGE: 'Changed password for', PASSWORD_RESET: 'Reset password for', VERIFY_EMAIL: 'Verified email for', UPLOAD_ASSET: 'Replaced asset for', VIEWED: 'Marked viewed', RESOLVE: 'Resolved', RETRIED: 'Queued email retry for', RESENT: 'Queued email resend for', DELIVERY_COMPLETED: 'Completed email delivery for', REMINDER_DELIVERY: 'Processed reminder for', ASSOCIATION_PENALTY_RECALCULATED: 'Recalculated late penalty for' }
export const roleLabels = { ADMIN: 'Admin', COLLECTOR: 'Billing Associate', RESIDENT: 'Resident', SYSTEM: 'System', UNKNOWN: 'Unknown actor', DELETED: 'Unknown actor' }
const fields = { id: 'Record ID', entityId: 'Record ID', unitId: 'Unit ID', unitNumber: 'Unit', fullName: 'Name', email: 'Email', isActive: 'Account active', approvalStatus: 'Account approval', emailVerified: 'Email verified', periodStart: 'Period start', periodEnd: 'Period end', dueDate: 'Due date', waterRatePerCubicM: 'Water rate / m³', associationDuesRatePerSqm: 'Association dues rate / m²', latePenaltyPercent: 'Late penalty (%)', latePenaltyAmount: 'Late penalty', status: 'Status', reviewStatus: 'Review status', previousReading: 'Previous reading (m³)', currentReading: 'Current reading (m³)', readingCount: 'Meter readings', billCount: 'SOAs', periodCount: 'Billing periods', warningCount: 'Warnings', removedBills: 'SOAs removed', officialReceiptNo: 'Transaction reference', ocrReferenceNo: 'Receipt reference (OCR)', verifiedReferenceNo: 'Receipt reference (verified)', verifiedAmount: 'Verified amount', paymentPurpose: 'Payment purpose', paymentMethod: 'Payment method', invoiceNumber: 'Invoice number', publishedAt: 'Published at', publishedBy: 'Published by', credentialChanged: 'Password changed', sessionsInvalidated: 'Previous sessions invalidated', billableAreaSqm: 'Billable area (m²)', relationshipType: 'Relationship', isPrimaryPayer: 'Primary payer', occupancyStatus: 'Occupancy', assetPresent: 'Asset available', mimeType: 'File type', originalFilename: 'Filename', receiptOriginalName: 'Receipt filename', forecastsRefreshed: 'Forecasts refreshed', recommendationsRefreshed: 'Recommendations refreshed', soaReissued: 'SOAs reissued', cancelledEmailDeliveries: 'Cancelled email deliveries', queuedEmails: 'Emails queued', unpublishedCount: 'SOAs unpublished' }
const hidden = /password|secret|token|otp|hash|raw_?text|ocrRawText|workbook_?data|buffer|cloudinary|public_?id|receipt_?path|(?:asset|receipt|signed|private|delivery).*url/i
const omitted = /^(createdAt|updatedAt|created_at|updated_at|bills|billIds|readings|periods)$/
export function auditLabel(value, labels = {}) { return labels[value] || fields[value] || String(value || 'Not recorded').replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/^./, c => c.toUpperCase()) }
export function auditTime(value) {
  if (!value || Number.isNaN(Date.parse(value))) return 'Not recorded'
  return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value))
}
export function auditDate(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(String(value)) || Number.isNaN(Date.parse(String(value).slice(0, 10)))) return 'Not recorded'
  return new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(String(value).slice(0, 10) + 'T00:00:00Z'))
}
export function auditTargetLabel(log) {
  const target = log.context?.target || { ...log.oldValues, ...log.newValues }
  let label = target.label || `${auditLabel(log.entityName, entityLabels)}${log.entityId != null ? ` #${log.entityId}` : ''}`
  if (log.entityName === 'PAYMENT_SUBMISSION' && target.paymentReference) label = `Payment ${target.paymentReference}`
  if (target.fullName && log.entityName === 'USER_ACCOUNT') label += ` · ${target.fullName}`
  if (target.unitNumber) label += ` · Unit ${target.unitNumber}`
  if (target.periodStart && target.periodEnd) label += ` · ${auditDate(target.periodStart)} – ${auditDate(target.periodEnd)}`
  else if (target.periodMonth) label += ` · ${target.periodMonth}`
  if (target.type) label += ` · ${target.type === 'qr' ? 'Payment QR code' : auditLabel(target.type)}`
  return label
}
export function auditSummary(log) {
  const action = log.entityName === 'BILLING_ERROR_REPORT' && log.action === 'CREATE' ? 'SUBMIT' : log.action
  return `${auditLabel(action, actionLabels)} ${auditTargetLabel(log)}`
}
export function auditValue(value, field = '') {
  if (value === undefined) return 'Not recorded'
  if (value === null || value === '') return 'None'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.length ? value.map(item => auditValue(item)).join('; ') : 'None'
  if (typeof value === 'object') return Object.entries(value).filter(([key]) => !hidden.test(key) && !omitted.test(key)).map(([key, item]) => `${auditLabel(key)}: ${auditValue(item, key)}`).join(' · ') || 'None'
  if (/Date$|^periodStart$|^periodEnd$/.test(field) && /^\d{4}-\d{2}-\d{2}/.test(value)) return auditDate(value)
  if (/At$/.test(field) && /^\d{4}-\d{2}-\d{2}/.test(value)) return auditTime(value)
  if (/amount|balance|charge|rate/i.test(field) && Number.isFinite(Number(value))) return `₱${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (typeof value === 'number') return value.toLocaleString('en-PH', { maximumFractionDigits: 3 })
  if (/status|purpose|method|role|type/i.test(field) && /^[A-Z_]+$/.test(value)) return auditLabel(value, roleLabels)
  return String(value)
}
function flatten(value, prefix = '', result = {}) {
  for (const [key, item] of Object.entries(value || {})) {
    if (hidden.test(key) || omitted.test(key)) continue
    const path = prefix ? `${prefix}.${key}` : key
    if (item && typeof item === 'object' && !Array.isArray(item)) flatten(item, path, result)
    else result[path] = item
  }
  return result
}
export function auditChanges(before, after) {
  const previous = flatten(before), next = flatten(after)
  return [...new Set([...Object.keys(previous), ...Object.keys(next)])].filter(key => JSON.stringify(previous[key]) !== JSON.stringify(next[key])).map(key => ({ key, label: key.split('.').map(part => auditLabel(part)).join(' · '), before: auditValue(previous[key], key.split('.').at(-1)), after: auditValue(next[key], key.split('.').at(-1)) }))
}
