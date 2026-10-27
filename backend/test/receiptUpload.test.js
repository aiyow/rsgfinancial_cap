import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import express from 'express';
import sharp from 'sharp';
import { receiptUpload } from '../middleware/receiptUpload.js';
import errorHandler from '../middleware/errorHandler.js';
import paymentRoutes from '../routes/paymentRoutes.js';
import { MAX_RECEIPT_BYTES, receiptExtension, receiptFileError } from "../services/receipts.js";

test('receipt metadata allows only the four requested extensions and enforces size', () => {
  for (const name of ['receipt.jpg', 'receipt.jpeg', 'receipt.jfif', 'receipt.png', 'RECEIPT.JPG', 'receipt.JFIF']) {
    assert.equal(receiptFileError({ name, size: 100 }), '');
  }
  for (const name of ['receipt.pdf', 'receipt.gif', 'receipt.webp', 'receipt.svg', 'receipt.xlsx', 'receipt.txt', 'receipt.jpg.exe', 'receipt', 'receipt.png ', 'receipt.jpg\n']) {
    assert.equal(receiptExtension(name), '');
    assert.match(receiptFileError({ name, size: 100 }), /Only JPEG/);
  }
  assert.match(receiptFileError(null), /Choose/);
  assert.match(receiptFileError({ name: 'receipt.png', size: 0 }), /empty/);
  assert.equal(receiptFileError({ name: 'receipt.png', size: MAX_RECEIPT_BYTES }), '');
  assert.match(receiptFileError({ name: 'receipt.png', size: MAX_RECEIPT_BYTES + 1 }), /5 MB/);
});

test('browser and API receipt policies stay identical', async () => {
  const service = (await readFile(new URL('../services/receipts.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const policySection = service.split('// #region Receipt file policy\n\n')[1].split('\n\n// #endregion')[0];
  assert.equal(policySection.trim(),
    (await readFile(new URL('../../frontend/src/utils/receiptFilePolicy.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n').trim());
});

test('both resident upload endpoints validate images before their payment handlers', () => {
  for (const path of ['/bills/:id/preview', '/bills/:id']) {
    const route = paymentRoutes.stack.find(layer => layer.route?.path === path && layer.route.methods.post).route;
    const index = route.stack.findIndex(layer => layer.handle === receiptUpload);
    assert.ok(index >= 0 && index < route.stack.length - 1);
  }
});

test('multipart preview and submission reject spoofed files and accept genuine JPEG/JFIF/PNG', async t => {
  // Exercise the production upload middleware with real multipart requests. No DB,
  // OCR, Cloudinary upload, email, or payment handler is called.
  const app = express();
  for (const path of ['/preview', '/submit']) {
    app.post(path, receiptUpload, (req, res) => res.json({ name: req.file.originalname, type: req.file.mimetype }));
  }
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const create = () => sharp({ create: { width: 16, height: 16, channels: 3, background: '#23965c' } });
  const png = await create().png().toBuffer();
  const jpeg = await create().jpeg().toBuffer();
  const gif = await create().gif().toBuffer();
  const webp = await create().webp().toBuffer();
  async function send(path, file, second) {
    const body = new FormData();
    if (file) body.append('receipt', new Blob([file.buffer], { type: file.type || 'application/octet-stream' }), file.name);
    if (second) body.append('receipt', new Blob([png], { type: 'image/png' }), 'second.png');
    const response = await fetch(url + path, { method: 'POST', body });
    return { status: response.status, body: await response.json() };
  }
  for (const path of ['/preview', '/submit']) {
    for (const [name, buffer, type] of [
      ['receipt.jpg', jpeg, 'image/jpeg'], ['receipt.jpeg', jpeg, 'image/jpeg'],
      ['receipt.jfif', jpeg, 'application/octet-stream'], ['receipt.JFIF', jpeg, 'image/pjpeg'],
      ['receipt.JPG', jpeg, 'image/png'], ['receipt.png', png, 'image/png'], ['receipt.PNG', png, 'application/octet-stream'],
    ]) {
      const response = await send(path, { name, buffer, type });
      assert.equal(response.status, 200, `${path} ${name}: ${response.body.message}`);
      assert.equal(response.body.type, buffer === png ? 'image/png' : 'image/jpeg');
    }
    for (const name of ['receipt.pdf', 'receipt.gif', 'receipt.webp', 'receipt.svg', 'receipt.txt', 'receipt.xlsx', 'receipt.png.exe', 'receipt']) {
      assert.equal((await send(path, { name, buffer: png, type: 'image/png' })).status, 400);
    }
    for (const [name, buffer] of [
      ['receipt.jpg', Buffer.from('%PDF-1.7 fake image')], ['receipt.png', Buffer.from('plain text')],
      ['receipt.png', gif], ['receipt.jpg', webp], ['receipt.png', jpeg], ['receipt.jfif', png],
      ['receipt.png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"></svg>')],
      ['receipt.png', png.subarray(0, Math.floor(png.length / 2))], ['receipt.jpg', Buffer.alloc(0)],
    ]) {
      assert.equal((await send(path, { name, buffer, type: 'image/jpeg' })).status, 400, `${path} must reject ${name}`);
    }
    assert.equal((await send(path, null)).status, 400);
    const tooLarge = await send(path, { name: 'large.png', buffer: Buffer.alloc(MAX_RECEIPT_BYTES + 1), type: 'image/png' });
    assert.equal(tooLarge.status, 400);
    assert.match(tooLarge.body.message, /5 MB/);
    assert.equal((await send(path, { name: 'one.png', buffer: png, type: 'image/png' }, true)).status, 400);
  }
});
