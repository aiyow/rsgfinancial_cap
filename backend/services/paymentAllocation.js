export const PAYMENT_PURPOSES = ['WATER', 'ASSOCIATION_DUES', 'COMBINED'];

export function cents(value) {
  const numeric = Number(value);
  const result = Math.round(numeric * 100);
  if (value == null || (typeof value === 'string' && !value.trim()) || typeof value === 'boolean' || !Number.isFinite(numeric) || numeric < 0 || numeric > 9999999999.99 || !Number.isSafeInteger(result) || Math.abs(numeric * 100 - result) > 0.00001) {
    throw Object.assign(new Error('Use a valid amount with at most two decimal places.'), { status: 400 });
  }
  return result;
}
export const money = (value) => Number((value / 100).toFixed(2));

export function allocatePaymentPurpose({ paymentPurpose, amount, associationRemaining = 0, waterRemaining = 0 }) {
  if (!PAYMENT_PURPOSES.includes(paymentPurpose)) throw Object.assign(new Error('Choose the payment purpose.'), { status: 400 });
  const total = cents(amount);
  if (!total) throw Object.assign(new Error('Payment amount must be positive.'), { status: 400 });
  const association = cents(associationRemaining);
  const water = cents(waterRemaining);
  let waterAmount = 0;
  let associationAmount = 0;
  if (paymentPurpose === 'WATER') waterAmount = total;
  else if (paymentPurpose === 'ASSOCIATION_DUES') associationAmount = total;
  else {
    waterAmount = Math.min(Math.max(total - association, 0), water);
    associationAmount = total - waterAmount;
  }
  return [
    { chargeType: 'ASSOCIATION_DUES', allocatedAmount: money(associationAmount) },
    { chargeType: 'WATER', allocatedAmount: money(waterAmount) },
  ].filter((row) => row.allocatedAmount > 0);
}

export function allowedPaymentPurposes(relationships) {
  if (relationships.includes('OWNER')) return [...PAYMENT_PURPOSES];
  return relationships.includes('TENANT') ? ['WATER'] : [];
}

export function allocateCategoryCredit({ principalRemaining, penaltyRemaining = 0, availableAmount }) {
  let available = cents(availableAmount);
  const principal = Math.min(cents(principalRemaining), available);
  available -= principal;
  const penalty = Math.min(cents(penaltyRemaining), available);
  return { principal: money(principal), penalty: money(penalty), advance: money(available - penalty) };
}
