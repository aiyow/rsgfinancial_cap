const dateOnly = (value) => value ? String(value).slice(0, 10) : ''

const defaultTemplate = {
  companyName: 'THE RESIDENS CONDOMINIUM CORPORATION',
  companyAddress: '360 Ramon Magsaysay Blvd., Zone 064 Brgy 632, Sta Mesa, Manila 1016',
  statementTitle: 'STATEMENT OF ACCOUNT',
  paymentChannel: 'GCASH',
  paymentAccountName: 'MADELYN JAMBALOS',
  paymentAccountNumber: '0908 674 2196',
  preparedByName: 'JERRY BOY CRISPE',
  preparedByTitle: 'BILLING ASSOCIATE',
  checkedByName: 'MARIQUT B. RIVERA',
  checkedByTitle: 'BUILDING ADMIN',
  noticeLine1: 'This temporary arrangement will remain in place until the defunct Board of Trustees formally turn over',
  noticeLine2: 'our Official Bank Passbook and Cheque book to the Elected Board of Trustees.',
  footerText: 'T H A N K   Y O U!',
}

function billingDate(bill) {
  return `${dateOnly(bill.periodStart)} - ${dateOnly(bill.periodEnd)}`
}

function chargeByType(bill, type) {
  return (bill.charges || []).find((charge) => charge.chargeType === type)
}

function amountOf(charge) {
  return Number(charge?.amount || 0)
}

function CurrencyCell({ value, strong = false }) {
  return (
    <td className={`soa-currency ${strong ? 'font-black' : ''}`}>
      <span>PHP</span>
      <span>{Number(value || 0).toFixed(2)}</span>
    </td>
  )
}

export default function SoaDocument({ bill }) {
  const template = { ...defaultTemplate, ...(bill.soaTemplate || {}) }
  const association = chargeByType(bill, 'ASSOCIATION_DUES')
  const water = chargeByType(bill, 'WATER')
  const remainingBalance = Number(bill.remainingBalance ?? bill.totalAmount ?? 0)
  const advanceBalance = Number(bill.advanceBalance || 0)
  const approvedAmount = Number(bill.approvedAmount || 0)

  return (
    <article className="print-document soa-sheet overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
      {bill.generationWarning && <p className="print-hidden m-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">Warning: {bill.generationWarning}</p>}

      <div className="grid grid-cols-[1fr_1fr] border-b border-slate-500">
        <div className="flex min-h-28 items-center justify-center border-r border-slate-400 p-3">
          <img src="/residens-logo.png" alt={template.companyName} className="max-h-24 w-full object-contain" />
        </div>
        <div className="text-center text-sm font-black">
          <div className="border-b border-slate-300 py-1 text-base">{template.statementTitle}</div>
          <div className="border-b border-slate-300 py-1">UNIT {bill.unitNumber}</div>
          <div className="border-b border-slate-300 py-1">{bill.payerName || 'NO ASSIGNED PAYER'}</div>
          <div className="grid grid-cols-[1fr_1fr] border-b border-slate-300">
            <span className="border-r border-slate-300 py-1 text-right pr-2">Statement Date</span>
            <span className="py-1">{dateOnly(bill.statementDate)}</span>
          </div>
          <div className="grid grid-cols-[1fr_1fr]">
            <span className="border-r border-slate-300 py-1 text-right pr-2">Due Date</span>
            <span className="py-1">{dateOnly(bill.dueDate)}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[2fr_3fr] border-b border-slate-500 bg-sky-200 text-sm">
        <div className="grid grid-cols-[1fr_1.7fr] border-r border-slate-600">
          <span className="border-b border-r border-slate-600 p-1 font-black">PAYMENT CHANNEL</span>
          <span className="border-b border-slate-600 p-1 text-center font-black">{template.paymentChannel}</span>
          <span className="border-b border-r border-slate-600 p-1 font-black">ACCOUNT NAME</span>
          <span className="border-b border-slate-600 p-1 text-center font-black">{template.paymentAccountName}</span>
          <span className="border-r border-slate-600 p-1 font-black">ACCOUNT NUMBER</span>
          <span className="p-1 text-center font-black">{template.paymentAccountNumber}</span>
        </div>
        <div className="flex items-center justify-center p-2 text-center text-xs font-bold text-slate-700">
          {template.companyName}<br />{template.companyAddress}
        </div>
      </div>

      <table className="soa-table">
        <thead>
          <tr className="bg-green-900 text-white">
            <th>Billing Date</th>
            <th>Description</th>
            <th>Previous</th>
            <th>Payment</th>
            <th>Invoice</th>
            <th>Current</th>
            <th>Penalty</th>
            <th>Billed Amount</th>
            <th>Total Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr className="bg-green-900 text-white">
            <td colSpan="9" className="text-center font-black">BALANCE</td>
          </tr>
          <tr>
            <td>{billingDate(bill)}</td>
            <td className="font-black">{association?.description || 'Association Dues'}</td>
            <td></td>
            <td></td>
            <td></td>
            <CurrencyCell value={amountOf(association)} />
            <td></td>
            <CurrencyCell value={amountOf(association)} />
            <td className="text-center">-</td>
          </tr>
          <tr>
            <td>{billingDate(bill)}</td>
            <td className="font-black">{water?.description || 'Water Rate'}</td>
            <td className="text-right">{bill.previousReading ?? ''}</td>
            <td></td>
            <td></td>
            <td className="text-right">{bill.currentReading ?? ''}</td>
            <td></td>
            <CurrencyCell value={amountOf(water)} />
            <CurrencyCell value={remainingBalance} />
          </tr>
          <tr>
            <td colSpan="5"></td>
            <td colSpan="2" className="bg-orange-200 text-center font-black">TOTAL AMOUNT</td>
            <CurrencyCell value={bill.totalAmount} strong />
            <CurrencyCell value={remainingBalance} strong />
          </tr>
        </tbody>
      </table>

      <table className="soa-table">
        <tbody>
          <tr className="bg-green-200">
            <td colSpan="5" className="text-center text-xs font-black">ADVANCE PAYMENT</td>
            <td colSpan="4" className="text-center text-xs font-black">ADVANCE BALANCE</td>
          </tr>
          <tr>
            <td colSpan="2" className="text-center text-xs font-black">APPROVED PAYMENTS</td>
            <CurrencyCell value={approvedAmount} />
            <td colSpan="3"></td>
            <CurrencyCell value={advanceBalance} />
            <td colSpan="2" className="text-center">-</td>
          </tr>
          <tr>
            <td colSpan="2" className="text-center text-xs font-black">REMAINING BALANCE</td>
            <CurrencyCell value={remainingBalance} />
            <td colSpan="6"></td>
          </tr>
        </tbody>
      </table>

      <div className="grid grid-cols-2 border-y border-slate-600 bg-sky-200 text-center text-xs font-black">
        <div className="border-r border-slate-600">
          <p className="border-b border-slate-600 py-3">PREPARED BY: {template.preparedByName}</p>
          <p className="py-3">{template.preparedByTitle}</p>
        </div>
        <div>
          <p className="border-b border-slate-600 py-3">CHECKED BY: {template.checkedByName}</p>
          <p className="py-3">{template.checkedByTitle}</p>
        </div>
      </div>

      <div className="border-b border-slate-600 bg-sky-200 text-center text-xs font-black">
        {template.noticeLine1 && <p className="border-b border-slate-600 py-2">{template.noticeLine1}</p>}
        {template.noticeLine2 && <p className="py-2">{template.noticeLine2}</p>}
      </div>
      <p className="bg-green-200 py-2 text-center text-xs font-black">{template.footerText}</p>
    </article>
  )
}
