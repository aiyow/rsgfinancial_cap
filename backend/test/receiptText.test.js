import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeReceiptText, parseReceiptText, reconcileReceiptFields } from "../services/receipts.js";

for (const [token, expected] of [
  ['₱1,220.00', 1220], ['£1,030.00', 1030], ['$1,600.00', 1600],
  ['£1 500.00', 1500], ['PHP 1, 500.00', 1500], ['P 1 500.00', 1500],
  ['1\u00a0500.00', 1500], ['1 234 567.89', 1234567.89],
  ['1500.50', 1500.5], ['71,220.00', 71220],
]) {
  test(`detects the complete amount in ${token}`, () => {
    assert.equal(parseReceiptText(`Total Amount Sent ${token}`).amount, expected);
  });
}

test('the total takes precedence over the transfer amount or fee', () => {
  assert.equal(parseReceiptText('Amount 1,000.00\nFee 15.00\nTotal Amount Sent ₱1,015.00').amount, 1015);
});

test('reads an amount on the line following its label', () => {
  assert.equal(parseReceiptText('Total Amount Sent\nPHP 1,220.00').amount, 1220);
});

for (const token of ['1,50.00', '1 50.00', '1,500.000', '0.00', '-1500.00']) {
  test(`does not return a positive partial amount for ${token}`, () => {
    assert.equal(parseReceiptText(`Total Amount Sent ${token}`).amount, null);
  });
}

test('ignores phone numbers, reference numbers and environmental footer numbers', () => {
  assert.equal(parseReceiptText('+63 921 208 2987\nRef No. 8045 103 259255\n279g (gCO2e)').amount, null);
});

for (const amount of ['1,220.00', '1,030.00', '1,600.00']) {
  test(`requires a clear OCR pass to resolve the peso-as-7 ambiguity for ${amount}`, () => {
    const ambiguous = parseReceiptText(`Amount ${amount}\nTotal Amount Sent 7${amount}`);
    assert.equal(ambiguous.amount, null);
    assert.equal(reconcileReceiptFields([ambiguous, parseReceiptText(`Amount ${amount}\nTotal Amount Sent £${amount}`)]).amount, Number(amount.replace(',', '')));
    assert.equal(reconcileReceiptFields([ambiguous, ambiguous]).amount, null);
  });
}

test('keeps a genuine total starting with 7 when the currency or repeated amount confirms it', () => {
  assert.equal(parseReceiptText('Amount 1,220.00\nTotal Amount Sent ₱71,220.00').amount, 71220);
  assert.equal(parseReceiptText('Amount 71,220.00\nTotal Amount Sent 71,220.00').amount, 71220);
});

test('does not choose between genuine conflicting OCR amounts, dates or references', () => {
  assert.deepEqual(reconcileReceiptFields([
    parseReceiptText('Amount ₱1,220.00\nRef No. ABC123456\nSep 16, 2026'),
    parseReceiptText('Amount ₱1,230.00\nRef No. ABC123457\nSep 17, 2026'),
  ]), { amount: null, referenceNo: null, paymentDate: null });
});

for (const date of ['Oct 10,2026 8:53 AM', 'Oct 10, 2026 8:53 AM', 'October 10 , 2026', '10 Oct 2026', '2026-10-10', '10/10/2026']) {
  test(`reads payment date ${date}`, () => {
    assert.equal(parseReceiptText(date).paymentDate, '2026-10-10');
  });
}

test('rejects invalid dates even when date punctuation is repaired', () => {
  assert.equal(parseReceiptText('Feb 30,2026').paymentDate, null);
});

test('keeps the reference separate from an adjacent date', () => {
  assert.equal(parseReceiptText('Ref No. 1234 567 890123 Oct 10,2026 8:53 AM').referenceNo, '1234567890123');
});

test('field parsing preserves the original names, masks and OCR transcription', () => {
  const original = 'JO••N D.\nTotal Amount Sent £1 500.00\nOct 10,2026 8:53 AM';
  assert.equal(normalizeReceiptText(original), original);
  assert.equal(parseReceiptText(original).amount, 1500);
});
