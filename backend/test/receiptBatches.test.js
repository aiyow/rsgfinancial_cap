import assert from 'node:assert/strict';
import test from 'node:test';
import { detectReceiptType, parseReceiptText, referenceValueWords } from '../services/receipts.js';
import { analyzeReceiptImages, insertReceiptImages, mergeReceiptAnalyses, receiptHash, receiptTypeFromRequest, uploadReceiptImages } from '../services/receiptBatches.js';

const image = (fields = {}) => ({ quality: { status: 'GOOD' }, rawText: 'Sanitized receipt', confidence: 90,
  amount: null, referenceNo: null, paymentDate: null, warnings: [], ...fields });

test('reference cropping excludes a tall copy icon but preserves actual final digit fragments', () => {
  const reference = { text: '6046000000001', bbox: { x0: 100, y0: 100, x1: 475, y1: 133 } };
  const digit = { text: '0', bbox: { x0: 495, y0: 100, x1: 524, y1: 133 } };
  const icon = { text: '0', bbox: { x0: 495, y0: 80, x1: 546, y1: 146 } };
  assert.deepEqual(referenceValueWords([reference, icon]), [reference]);
  assert.deepEqual(referenceValueWords([reference, digit]), [reference, digit]);
});

test('bank parsers handle notification punctuation, outgoing debit, and alphanumeric references', () => {
  assert.deepEqual(parseReceiptText('You have sent PHP 375.00 to A***B on 10-21-2026 08:17 PM. Your new balance is PHP 2803.58. Ref. No. 6046000000001.', 'GCASH'),
    { amount: 375, referenceNo: '6046000000001', paymentDate: '2026-10-21' });
  assert.equal(parseReceiptText('Amount -375.00\nReference Number 6046000000001', 'GCASH').amount, 375);
  assert.equal(parseReceiptText('Amount -375.00', 'OTHER').amount, null);
  assert.equal(parseReceiptText('Trace ID 000015\nReference No. IT0261024000000001', 'GOTYME').referenceNo, 'IT0261024000000001');
  assert.equal(parseReceiptText('Confirmation No. 1630000000001\nTransaction Ref. No. 571500', 'BPI').referenceNo, '571500');
  assert.equal(parseReceiptText('Reference no.\nBN-20261112-12345678\nInvoice no.\n649700', 'BDO').referenceNo, 'BN-20261112-12345678');
});

test('principal excludes bank fees, new balance and referral promotions', () => {
  for (const text of ['Transfer Amount PHP 500.00\nTransfer Fee PHP 15.00\nTotal Amount PHP 515.00',
    'Amount PHP 500.00\nFee PHP 15.00\nTotal PHP 515.00', 'Service Fee PHP 15.00\nTotal Amount PHP 515.00']) {
    assert.equal(parseReceiptText(text).amount, 500);
  }
  assert.equal(parseReceiptText('Transfer Amount PHP 500.00\nGet up to ₱588 with my referral code').amount, 500);
});

test('detects the issuing bank separately from the recipient bank', () => {
  assert.equal(detectReceiptType('MariBank\nTransaction Receipt\nFrom Sender\nTo Maya Wallet'), 'MARIBANK');
  assert.equal(detectReceiptType('Transfer Result\nFrom Sender\nMariBank: ***1234\nTo GCash'), 'MARIBANK');
  assert.equal(detectReceiptType('To GCash\nFrom Sender\nGoTyme Bank\nAmount ₱500.00'), 'GOTYME');
  assert.equal(detectReceiptType('Sent via BPI\nTransfer to\nMariBank'), 'BPI');
  assert.equal(detectReceiptType('To BPI / VYBE by BPI\nReference no. BN-20261112-12345678\nBDO'), 'BDO');
  assert.equal(detectReceiptType('Express Send Notification\nYou have sent PHP 375.00'), 'GCASH');
});

test('only supported receipt types are accepted, while absent legacy types use Other', () => {
  assert.equal(receiptTypeFromRequest(undefined), 'OTHER');
  for (const type of ['GCASH', 'GOTYME', 'MARIBANK', 'BDO', 'BPI', 'MAYA', 'OTHER']) assert.equal(receiptTypeFromRequest(type), type);
  for (const type of ['', '__proto__', 'UNKNOWN', ['BDO', 'BPI']]) assert.throws(() => receiptTypeFromRequest(type), { status: 400 });
});

test('two screenshots supply one payment without adding repeated amounts', () => {
  const result = mergeReceiptAnalyses([image({ amount: 1675.88 }), image({ amount: 1675.88,
    referenceNo: 'BN-20261112-12345678', paymentDate: '2026-11-12', detectedReceiptType: 'BDO' })], 'BDO');
  assert.equal(result.amount, 1675.88);
  assert.equal(result.referenceNo, 'BN-20261112-12345678');
  assert.equal(result.paymentDate, '2026-11-12');
  assert.equal(result.complete, true);
  assert.deepEqual(result.images.map(img => img.position), [1, 2]);
  assert.equal(mergeReceiptAnalyses([image({ amount: 1675.88 }), image({ referenceNo: 'ABC12345', paymentDate: '2026-11-12' })]).complete, true);
});

test('conflicting images withhold only the conflicting fields and warn Admin', () => {
  const result = mergeReceiptAnalyses([image({ amount: 500, referenceNo: 'ABC12345', paymentDate: '2026-11-12' }),
    image({ amount: 600, referenceNo: 'ABC12346', paymentDate: '2026-11-12' })]);
  assert.equal(result.amount, null); assert.equal(result.referenceNo, null);
  assert.equal(result.paymentDate, '2026-11-12'); assert.equal(result.complete, false);
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings.join(' '), /same payment/);
});

test('quality errors identify the image to replace and remain incomplete', async () => {
  const files = [{ buffer: Buffer.from('a') }, { buffer: Buffer.from('b') }];
  const calls = [];
  const result = await analyzeReceiptImages(files, 'BDO', async (buffer, type) => {
    calls.push([buffer.toString(), type]);
    return image({ quality: { status: buffer.toString() === 'b' ? 'LOW_RESOLUTION' : 'GOOD' } });
  });
  assert.deepEqual(calls, [['a', 'BDO'], ['b', 'BDO']]);
  assert.equal(result.quality.imagePosition, 2); assert.equal(result.complete, false);
});

test('a failed second upload removes the first private image', async () => {
  const deleted = [];
  await assert.rejects(uploadReceiptImages([{ buffer: Buffer.from('a') }, { buffer: Buffer.from('b') }], {
    upload: async buffer => { if (buffer.toString() === 'b') throw new Error('Storage unavailable'); return { publicId: 'private/a' }; },
    destroy: async id => deleted.push(id),
  }), /Storage unavailable/);
  assert.deepEqual(deleted, ['private/a']);
});

test('each stored image keeps its own hash, order, MIME and analysis', async () => {
  const queries = [];
  const files = [{ buffer: Buffer.from('a'), originalname: 'part1.png', mimetype: 'image/png' },
    { buffer: Buffer.from('b'), originalname: 'part2.jpg', mimetype: 'image/jpeg' }];
  await insertReceiptImages({ query: async (sql, params) => queries.push({ sql, params }) }, 123, files,
    [{ publicId: 'private/a' }, { publicId: 'private/b' }], { images: [image({ amount: 500 }), image({ referenceNo: 'ABC12345' })] });
  assert.deepEqual(queries.map(q => q.params.slice(0, 3)), [[123, 1, 'private/a'], [123, 2, 'private/b']]);
  assert.deepEqual(queries.map(q => q.params[5]), files.map(file => receiptHash(file.buffer)));
  assert.equal(JSON.parse(queries[1].params[6]).referenceNo, 'ABC12345');
});
