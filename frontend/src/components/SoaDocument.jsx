import { useEffect, useState } from 'react'
import useAuth from '../hooks/useAuth'
import { apiFile } from '../services/api'

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
  logoPlacement: 'LEFT',
  accentColor: '#617c40',
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

export default function SoaDocument({ bill, showPaymentQr = true }) {
  const { token } = useAuth()
  const template = { ...defaultTemplate, ...(bill.soaTemplate || {}) }
  const [assets, setAssets] = useState({ logo: '', qr: '' })

  useEffect(() => {
    let active = true
    const urls = []
    async function loadAssets() {
      const read = async (type) => {
        try {
          const blob = await apiFile(`/api/soa-template/assets/${type}`, { token })
          const url = URL.createObjectURL(blob)
          urls.push(url)
          return url
        } catch {
          return ''
        }
      }
      const [logo, qr] = await Promise.all([read('logo'), showPaymentQr ? read('qr') : Promise.resolve('')])
      if (active) setAssets({ logo, qr })
    }
    loadAssets()
    return () => {
      active = false
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [showPaymentQr, token])

  const association = chargeByType(bill, 'ASSOCIATION_DUES')
  const water = chargeByType(bill, 'WATER')
  const remainingBalance = Number(bill.remainingBalance ?? bill.totalAmount ?? 0)
  const advanceBalance = Number(bill.advanceBalance || 0)
  const approvedAmount = Number(bill.approvedAmount || 0)
  const latePenaltyAmount = Number(bill.latePenaltyAmount || 0)
  const paymentReference = [template.paymentChannel, template.paymentAccountNumber, template.paymentAccountName].filter(Boolean).join(' • ')

  return (
    <article
      className="print-document soa-sheet overflow-hidden rounded-sm border-2 border-[#285b78] bg-white shadow-sm"
      style={{ '--soa-accent': template.accentColor || defaultTemplate.accentColor }}
    >
      {bill.generationWarning && <p className="print-hidden m-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">Warning: {bill.generationWarning}</p>}

      <header className="soa-header-grid">
        <div className={`soa-brand-panel ${template.logoPlacement === 'LEFT' ? 'justify-start' : template.logoPlacement === 'RIGHT' ? 'justify-end' : 'justify-center'}`}>
          <img src={assets.logo || '/residens-logo.png'} alt={template.companyName} className="soa-brand-logo" />
          <p className="soa-company-address">{template.companyAddress}</p>
        </div>
        <div className="soa-account-panel">
          <p className="soa-statement-title">{template.statementTitle}</p>
          <p className="soa-payer-name">{bill.payerName || 'NO ASSIGNED PAYER'}</p>
          <p className="soa-unit-number">UNIT {bill.unitNumber}</p>
          <p><strong>Statement Date:</strong> {dateOnly(bill.statementDate)}</p>
          <p className="soa-due-date"><strong>Due Date:</strong> {dateOnly(bill.dueDate)}</p>
        </div>
      </header>

      <section className="soa-payment-band" aria-label="Payment details">
        <dl className="soa-payment-details">
          <dt>Payment channel</dt><dd>{template.paymentChannel || '—'}</dd>
          <dt>Account name</dt><dd>{template.paymentAccountName || '—'}</dd>
          <dt>Account number</dt><dd>{template.paymentAccountNumber || '—'}</dd>
        </dl>
        <p className="soa-payment-instruction">PAYMENT DETAILS: {paymentReference || template.companyName}</p>
      </section>

      <table className="soa-table soa-primary-table">
        <colgroup>
          <col className="w-[16%]" /><col className="w-[16%]" /><col className="w-[10%]" /><col className="w-[9%]" /><col className="w-[9%]" /><col className="w-[11%]" /><col className="w-[8%]" /><col className="w-[11%]" /><col className="w-[12%]" />
        </colgroup>
        <thead>
          <tr>
            <th>Billing Date</th><th>Description</th><th>Previous Balance</th><th>Payment</th><th>Invoice</th><th>Current</th><th>Penalty</th><th>Billed Amount</th><th>Total Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr className="soa-balance-row"><td colSpan="9">BALANCE</td></tr>
          <tr>
            <td>{billingDate(bill)}</td>
            <td className="font-black">{association?.description || 'Association Dues'}</td>
            <td className="text-center">—</td><td className="text-center">—</td><td className="text-center">—</td>
            <CurrencyCell value={amountOf(association)} />
            <td className="text-center">—</td><CurrencyCell value={amountOf(association)} /><td className="text-center">—</td>
          </tr>
          <tr>
            <td>{billingDate(bill)}</td>
            <td className="font-black">{water?.description || 'Water Rate'}</td>
            <td className="text-center">{bill.previousReading ?? '—'}</td><td className="text-center">—</td><td className="text-center">—</td>
            <td className="text-center">{bill.currentReading ?? '—'}</td><CurrencyCell value={latePenaltyAmount} /><CurrencyCell value={amountOf(water)} /><CurrencyCell value={remainingBalance} />
          </tr>
          <tr className="soa-total-row">
            <td colSpan="5"></td><td colSpan="2" className="text-center font-black">TOTAL AMOUNT</td><CurrencyCell value={bill.totalAmount} strong /><CurrencyCell value={remainingBalance} strong />
          </tr>
        </tbody>
      </table>

      <table className="soa-table soa-summary-table">
        <tbody>
          <tr className="soa-summary-heading"><td colSpan="5">ADVANCE PAYMENT</td><td colSpan="4">ADVANCE BALANCE</td></tr>
          <tr>
            <td colSpan="2" className="font-black">APPROVED PAYMENTS</td><CurrencyCell value={approvedAmount} /><td colSpan="3"></td><CurrencyCell value={advanceBalance} /><td colSpan="2" className="text-center">—</td>
          </tr>
          <tr><td colSpan="2" className="font-black">REMAINING BALANCE</td><CurrencyCell value={remainingBalance} strong /><td colSpan="6"></td></tr>
        </tbody>
      </table>

      <section className="soa-reference-section">
        <div className="soa-reference-copy">
          <p><strong>Official Receipt No.:</strong> {bill.officialReceiptNumber || '—'}</p>
          <p><strong>Invoice No.:</strong> {bill.invoiceNumber || '—'}</p>
          {bill.paymentNote && <p><strong>Payment note:</strong> {bill.paymentNote}</p>}
        </div>
        {showPaymentQr && assets.qr && <figure className="soa-qr-card"><img src={assets.qr} alt="Payment QR code" /><figcaption>SCAN TO PAY</figcaption></figure>}
      </section>

      <section className="soa-signature-band">
        <div><p>PREPARED BY: {template.preparedByName}</p><p>{template.preparedByTitle}</p></div>
        <div><p>CHECKED BY: {template.checkedByName}</p><p>{template.checkedByTitle}</p></div>
      </section>

      <footer className="soa-footer">
        {template.noticeLine1 && <p>{template.noticeLine1}</p>}
        {template.noticeLine2 && <p>{template.noticeLine2}</p>}
        <p className="soa-thank-you">{template.footerText}</p>
      </footer>
    </article>
  )
}
