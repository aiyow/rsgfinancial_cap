// One user can hold both assignments; an active owner assignment takes precedence.
export function recipientPaymentDetails(delivery) {
  const charges = delivery.chargePayments;
  if (!charges) return delivery;
  const water = Number(charges.WATER?.remainingBalance || 0);
  const association = Number(charges.ASSOCIATION_DUES?.remainingBalance || 0);
  const tenant = delivery.relationshipType === 'TENANT';
  return { ...delivery, waterBalance: water, associationBalance: association,
    remainingBalance: tenant ? water : water + association,
    latePenaltyAmount: tenant ? 0 : Number(charges.ASSOCIATION_DUES?.penaltyAmount || 0),
    balanceLabel: tenant ? 'Water balance' : 'Remaining balance' };
}
