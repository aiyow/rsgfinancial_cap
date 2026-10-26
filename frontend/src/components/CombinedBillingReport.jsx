const moneyFields = [
  ['duesBilled','Association Dues'], ['waterBilled','Water Bill'], ['latePenalty','Penalties'],
  ['totalBilled','Total Billed'], ['paidAmount','Paid'], ['remainingBalance','Remaining Balance'],
]
const statuses = { PAID:'Paid', PARTIAL:'Partially Paid', UNPAID:'Unpaid', NO_CHARGES:'No Charges', NO_SOA:'No SOA' }
const money = value => new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value || 0))

export default function CombinedBillingReport({ report, print = false }) {
  const combined = report.combined
  if (!combined) return <p role="alert" className="text-sm text-slate-600">Overall billing is unavailable. Reload the report.</p>
  const { rows,totals } = combined
  return <section aria-label="Overall billing report" className="space-y-4">
    {!print && <div className="grid gap-3 sm:grid-cols-3">
      {[['Total Billed','totalBilled','border-l-blue-600'],['Total Paid','paidAmount','border-l-emerald-600'],['Remaining Balance','remainingBalance','border-l-amber-500']].map(([label,key,tone]) => <div key={key} data-summary={key} className={`rounded-xl border border-slate-200 bg-white p-4 border-l-4 shadow-sm ${tone}`}>
        <p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-2 break-words text-xl font-black tabular-nums text-slate-900">{money(totals[key])}</p>
      </div>)}
    </div>}
    <div className={print ? '' : 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5'}>
      {!print && <h2 className="mb-4 text-lg font-black text-slate-900">Overall Billing by Unit</h2>}
      <div className="financial-report-table-scroll max-h-[560px] overflow-auto rounded-xl border border-slate-200">
        <table aria-label="Overall billing by unit" className="financial-report-table combined-billing-table w-full min-w-[980px] text-left text-xs">
          <caption className="sr-only">Association dues and water bills with paid and unpaid balances for every unit.</caption>
          <thead className="sticky top-0 z-10 bg-emerald-50 text-emerald-950"><tr><th scope="col" className="px-3 py-3 font-bold">Unit</th><th scope="col" className="min-w-40 px-3 py-3 font-bold">Resident/Payer</th>{moneyFields.map(([key,label])=><th key={key} scope="col" className="px-3 py-3 text-right font-bold">{label}</th>)}<th scope="col" className="px-3 py-3 font-bold">Status</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.length ? rows.map(row => <tr key={row.unitId} className="hover:bg-slate-50">
            <th scope="row" className="whitespace-nowrap px-3 py-3 font-bold text-slate-900">{row.unitNumber}</th>
            <td className="max-w-60 break-words px-3 py-3 text-slate-600 [overflow-wrap:anywhere]">{row.payerName}</td>
            {moneyFields.map(([key])=><td key={key} className={`whitespace-nowrap px-3 py-3 text-right tabular-nums ${key === 'totalBilled' || key === 'remainingBalance' ? 'font-bold text-slate-900' : 'text-slate-700'}`}>{money(row[key])}</td>)}
            <td className="px-3 py-3"><span className={`inline-block whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-bold ${row.status === 'PAID' ? 'bg-emerald-50 text-emerald-800' : row.status === 'PARTIAL' ? 'bg-amber-50 text-amber-800' : row.status === 'UNPAID' ? 'bg-rose-50 text-rose-800' : 'bg-slate-100 text-slate-600'}`}>{statuses[row.status]}</span></td>
          </tr>) : <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-500">No units are available in the directory.</td></tr>}</tbody>
          <tfoot className="border-t-2 border-emerald-200 bg-emerald-50"><tr><th scope="row" colSpan={2} className="px-3 py-3 font-black text-emerald-950">Grand Total</th>{moneyFields.map(([key])=><td key={key} className="whitespace-nowrap px-3 py-3 text-right font-black tabular-nums text-emerald-950">{money(totals[key])}</td>)}<td /></tr></tfoot>
        </table>
      </div>
      {!print && <p className="mt-3 text-xs text-slate-500">{rows.length} units · Paid, partially paid and unpaid balances shown together.</p>}
    </div>
  </section>
}
