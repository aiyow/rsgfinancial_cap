import { allowedPaymentPurposes } from './paymentAllocation.js';

export async function decorateResidentBills(client, bills, user) {
  if (user.role !== 'RESIDENT' || !bills.length) return bills;
  const assignments = await client.query(`SELECT unit_id,relationship_type FROM unit_assignments
    WHERE user_id=$1 AND end_date IS NULL AND start_date <= (NOW() AT TIME ZONE 'Asia/Manila')::date`, [user.id]);
  return bills.map((bill) => {
    const purposes = allowedPaymentPurposes(assignments.rows.filter((row) => Number(row.unit_id) === Number(bill.unitId)).map((row) => row.relationship_type));
    const waterOnly = !purposes.includes('COMBINED');
    const payableBalance = Number(waterOnly ? bill.chargePayments?.WATER?.remainingBalance || 0 : bill.remainingBalance);
    const payableApprovedAmount = Number(waterOnly ? bill.chargePayments?.WATER?.approvedAmount || 0 : bill.approvedAmount);
    return { ...bill, allowedPaymentPurposes: purposes, payableBalance, payableApprovedAmount,
      payablePaymentStatus: payableBalance <= 0 ? 'PAID' : payableApprovedAmount > 0 ? 'PARTIAL' : bill.paymentStatus,
      hasPayablePendingPayment: waterOnly ? Boolean(bill.chargePayments?.WATER?.hasPendingPayment) : bill.hasPendingPayment };
  });
}
