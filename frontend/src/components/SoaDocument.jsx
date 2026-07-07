const dateOnly = (value) => value ? String(value).slice(0, 10) : ''

export default function SoaDocument({ bill }) {
  return (
    <article className="print-document rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-10">
      {bill.generationWarning && <p className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">Warning: {bill.generationWarning}</p>}
      <header className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row">
        <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-600">RSG Condominium</p><h2 className="mt-2 text-3xl font-black">Statement of Account</h2></div>
        <div className="text-sm sm:text-right"><p className="font-black">Unit {bill.unitNumber}</p><p>{bill.payerName || 'No assigned payer'}</p><p className="text-slate-500">{bill.payerEmail}</p></div>
      </header>
      <div className="grid gap-4 border-b border-slate-200 py-6 text-sm sm:grid-cols-4">
        <div><p className="text-xs font-bold uppercase text-slate-400">Billing period</p><p className="mt-1 font-bold">{dateOnly(bill.periodStart)} to {dateOnly(bill.periodEnd)}</p></div>
        <div><p className="text-xs font-bold uppercase text-slate-400">Statement date</p><p className="mt-1 font-bold">{dateOnly(bill.statementDate)}</p></div>
        <div><p className="text-xs font-bold uppercase text-slate-400">Due date</p><p className="mt-1 font-bold">{dateOnly(bill.dueDate)}</p></div>
        <div><p className="text-xs font-bold uppercase text-slate-400">Meter reading</p><p className="mt-1 font-bold">{bill.previousReading === null || bill.currentReading === null ? 'Reading unavailable' : `${bill.previousReading} to ${bill.currentReading} (${bill.consumption} m3)`}</p></div>
      </div>
      {(bill.paymentStatus || bill.remainingBalance !== undefined) && <div className="mt-6 grid gap-4 text-sm sm:grid-cols-3">
        <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase text-slate-400">Payment status</p><p className="mt-2 font-bold">{bill.paymentStatus || 'UNPAID'}</p></div>
        <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase text-slate-400">Approved payments</p><p className="mt-2 font-bold">PHP {Number(bill.approvedAmount || 0).toFixed(2)}</p></div>
        <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase text-slate-400">Remaining balance</p><p className="mt-2 font-bold">PHP {Number(bill.remainingBalance || bill.totalAmount || 0).toFixed(2)}</p></div>
      </div>}
      <table className="mt-7 w-full text-left text-sm"><thead className="text-xs uppercase text-slate-400"><tr><th className="pb-3">Description</th><th>Quantity</th><th>Rate</th><th className="text-right">Amount</th></tr></thead><tbody className="divide-y divide-slate-100">
        {bill.charges.map((charge) => <tr key={charge.id}><td className="py-4 font-bold">{charge.description}</td><td>{charge.quantity}</td><td>PHP {Number(charge.rateApplied).toFixed(2)}</td><td className="text-right">PHP {Number(charge.amount).toFixed(2)}</td></tr>)}
      </tbody></table>
      <div className="mt-6 flex justify-end border-t-2 border-slate-950 pt-5"><div className="text-right"><p className="text-xs font-bold uppercase text-slate-400">Total amount due</p><p className="mt-1 text-3xl font-black">PHP {Number(bill.totalAmount).toFixed(2)}</p></div></div>
    </article>
  )
}
