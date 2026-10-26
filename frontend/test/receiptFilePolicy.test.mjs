import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_RECEIPT_BYTES, RECEIPT_ACCEPT, receiptFileError } from '../src/utils/receiptFilePolicy.js'

test('resident picker and selection use exactly JPG, JPEG, JFIF, and PNG extensions', () => {
  assert.equal(RECEIPT_ACCEPT, '.jpg,.jpeg,.jfif,.png')
  for (const name of ['proof.jpg', 'proof.jpeg', 'proof.JFIF', 'proof.PNG']) {
    assert.equal(receiptFileError({ name, size: 100 }), '')
  }
  for (const name of ['proof.pdf', 'proof.webp', 'proof.gif', 'proof.svg', 'proof.xlsx', 'proof.jpg.exe']) {
    assert.match(receiptFileError({ name, size: 100 }), /Only JPEG/)
  }
  assert.match(receiptFileError({ name: 'proof.jpg', size: MAX_RECEIPT_BYTES + 1 }), /5 MB/)
  assert.match(receiptFileError({ name: 'proof.png', size: 0 }), /empty/)
})
