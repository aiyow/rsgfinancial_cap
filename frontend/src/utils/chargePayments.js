export const purposeLabels = { WATER: 'Water', ASSOCIATION_DUES: 'Association Dues', COMBINED: 'Water + Association Dues' }
export const currency = (value) => `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export function isWaterOnly(bill) { return bill?.allowedPaymentPurposes?.length === 1 && bill.allowedPaymentPurposes[0] === 'WATER' }
export function payableBalance(bill) { return Number(bill?.payableBalance ?? bill?.remainingBalance ?? 0) }
export function payablePaid(bill) { return Number(bill?.payableApprovedAmount ?? bill?.approvedAmount ?? 0) }
export function chargeDetails(bill, type) {
  if (bill?.chargePayments?.[type]) return bill.chargePayments[type]
  const amount = Number(bill?.charges?.find(row => row.chargeType === type)?.amount || 0)
  const penalty = type === 'ASSOCIATION_DUES' ? Number(bill?.latePenaltyAmount || 0) : 0
  return { currentAmount: amount, penaltyAmount: penalty, billedAmount: amount + penalty,
    approvedAmount: 0, remainingBalance: amount + penalty, advanceBalance: 0, invoiceReferences: [], payments: [] }
}
