import { chargeDetails, currency, isWaterOnly, purposeLabels } from '../utils/chargePayments'

export default function ChargePaymentSummary({ bill }) {
  return <dl className="grid grid-cols-2 gap-2 text-xs" aria-label="Charge balances">
    {['WATER', 'ASSOCIATION_DUES'].map(type => {
      const row = chargeDetails(bill, type)
      return <div key={type} className="min-w-0 rounded-lg border border-emerald-100 bg-emerald-50/50 p-3">
        <dt className="font-semibold text-slate-600">{purposeLabels[type]}{type === 'ASSOCIATION_DUES' && isWaterOnly(bill) && <span className="block text-[10px] font-normal">Owner’s balance</span>}</dt>
        <dd className="mt-1 text-base font-black tabular-nums">{currency(row.remainingBalance)}</dd>
        <dd className="mt-1 text-slate-500">Paid {currency(row.approvedAmount)}</dd>
        {Number(row.advanceBalance) > 0 && <dd className="mt-1 text-emerald-700">Advance {currency(row.advanceBalance)}</dd>}
        {row.hasPendingPayment && <dd className="mt-1 text-amber-700">Proof pending review</dd>}
      </div>
    })}
  </dl>
}
