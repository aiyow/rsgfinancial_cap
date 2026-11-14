import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { once } from 'node:events';
import { PGlite } from '@electric-sql/pglite';
import express from 'express';
import jwt from 'jsonwebtoken';
import sharp from 'sharp';
import { v2 as cloudinary } from 'cloudinary';
import pool from '../../config/db.js';
import paymentRoutes from '../../routes/paymentRoutes.js';
import errorHandler from '../../middleware/errorHandler.js';
import { ensureReceiptImagesSchema, receiptHash } from '../../services/receiptBatches.js';

// Real SQL, migrations, authentication, multipart validation and OCR. Only the
// database connection and Cloudinary transport are replaced. No live data is used.
test('receipt migration and HTTP flow preserve legacy data, image privacy, duplicates and rollback cleanup', { timeout: 180000 }, async t => {
  const db = new PGlite();
  const original = { query: pool.query, connect: pool.connect, fetch: globalThis.fetch,
    upload: cloudinary.uploader.upload_stream, destroy: cloudinary.uploader.destroy };
  const environment = { ...process.env };
  let server, uploaded = 0, failUploadAt = 0, failSecondImageInsert = false;
  const stored = new Map(), deleted = [];
  const makeReceipt = async (text, marker = '') => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200"><rect width="800" height="1200" fill="white"/><g font-family="Arial" font-size="30" fill="black">${text.split('\n').map((line, i) => `<text x="40" y="${100 + i * 70}">${line}</text>`).join('')}<text x="40" y="1100">${marker}</text></g></svg>`)).png().toBuffer();
  try {
    await db.exec(await readFile(new URL('../../database/schema.sql', import.meta.url), 'utf8'));
    const directory = new URL('../../database/migrations/', import.meta.url);
    for (const file of (await readdir(directory)).filter(f => /^\d{3}_.+\.sql$/.test(f) && !f.startsWith('045_')).sort()) {
      await db.exec(await readFile(new URL(file, directory), 'utf8'));
    }
    await db.exec(`INSERT INTO users(id,full_name,email,password_hash,role,is_active,approval_status,auth_version) VALUES
      (1,'Fixture Admin','admin@example.invalid','fixture','ADMIN',TRUE,'APPROVED',0),
      (2,'Fixture Resident','resident@example.invalid','fixture','RESIDENT',TRUE,'APPROVED',0),
      (3,'Other Resident','other@example.invalid','fixture','RESIDENT',TRUE,'APPROVED',0),
      (4,'Fixture Associate','associate@example.invalid','fixture','COLLECTOR',TRUE,'APPROVED',0);
      INSERT INTO units(id,unit_number,floor) VALUES(10,'Test 237','2');
      INSERT INTO unit_assignments(unit_id,user_id,relationship_type,start_date,is_primary_payer) VALUES(10,2,'OWNER','2020-01-01',TRUE);
      INSERT INTO billing_periods(id,period_start,period_end,due_date,water_rate_per_cubic_m,association_dues_rate_per_sqm,created_by)
        VALUES(1,'2026-10-01','2026-11-01','2099-01-01',10,10,1);
      INSERT INTO unit_bills(id,unit_id,billing_period_id,generated_by,unit_number_snapshot,period_start_snapshot,
        period_end_snapshot,statement_date,due_date_snapshot,published_at)
        VALUES(100,10,1,1,'Test 237','2026-10-01','2026-11-01','2026-11-01','2099-01-01',NOW());
      INSERT INTO bill_charges(unit_bill_id,charge_type,quantity,rate_applied) VALUES(100,'WATER',1,5000),(100,'ASSOCIATION_DUES',1,5000);`);
    const legacyBuffer = await makeReceipt('Receipt\nAmount PHP 100.00\nReference No. OLD123456\nNov 1, 2026', 'Legacy fixture');
    stored.set('fixture/legacy', legacyBuffer);
    const legacy = (await db.query(`INSERT INTO payment_submissions
      (unit_id,submitted_by,target_unit_bill_id,receipt_path,receipt_storage,receipt_cloudinary_public_id,
       receipt_original_name,receipt_mime_type,receipt_sha256,ocr_quality_status,payment_purpose)
      VALUES(10,2,100,'fixture/legacy','CLOUDINARY','fixture/legacy','old.png','image/png',$1,'GOOD','COMBINED') RETURNING id`, [receiptHash(legacyBuffer)])).rows[0].id;
    const before = (await db.query('SELECT to_jsonb(p) AS row FROM payment_submissions p WHERE id=$1', [legacy])).rows[0].row;
    await assert.rejects(ensureReceiptImagesSchema(db), { status: 503 });
    const migration = await readFile(new URL('045_receipt_images.sql', directory), 'utf8');
    await db.exec(migration); await db.exec(migration);
    await ensureReceiptImagesSchema(db);
    const after = (await db.query("SELECT to_jsonb(p)-'receipt_type'-'ocr_details' AS row FROM payment_submissions p WHERE id=$1", [legacy])).rows[0].row;
    assert.deepEqual(after, before);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM payment_receipt_images')).rows[0].n, 1);
    await assert.rejects(db.query('UPDATE payment_receipt_images SET position=3'), error => error.code === '23514');
    await assert.rejects(db.query(`INSERT INTO payment_receipt_images
      (payment_submission_id,position,storage,path,cloudinary_public_id,original_name,mime_type,sha256)
      SELECT payment_submission_id,2,storage,path,cloudinary_public_id,original_name,mime_type,sha256 FROM payment_receipt_images`), error => error.code === '23505');
    t.diagnostic('PASS idempotent migration backfills one image and preserves existing payment fields');

    process.env.JWT_SECRET = 'fixture-only-receipt-test';
    process.env.CLOUDINARY_CLOUD_NAME = 'fixture'; process.env.CLOUDINARY_API_KEY = 'fixture'; process.env.CLOUDINARY_API_SECRET = 'fixture';
    pool.query = async (sql, params) => {
      if (failSecondImageInsert && /INSERT INTO payment_receipt_images/i.test(sql) && params[1] === 2) throw new Error('Expected fixture database failure');
      return db.query(sql, params);
    };
    pool.connect = async () => ({ query: pool.query, release() {} });
    cloudinary.uploader.upload_stream = (options, callback) => {
      const chunks = [];
      return new Writable({ write(chunk, _encoding, next) { chunks.push(chunk); next(); }, final(next) {
        uploaded++;
        if (uploaded === failUploadAt) callback(new Error('Expected fixture storage failure'));
        else { const id = `fixture/${options.public_id}`; stored.set(id, Buffer.concat(chunks)); callback(null, { public_id: id }); }
        next();
      } });
    };
    cloudinary.uploader.destroy = async id => { deleted.push(id); stored.delete(id); return { result: 'ok' }; };
    globalThis.fetch = async (input, options) => {
      if (String(input).startsWith('https://res.cloudinary.com/')) {
        const item = [...stored].find(([id]) => new URL(String(input)).pathname.endsWith('/' + id));
        return item ? new Response(item[1], { headers: { 'content-type': 'image/png' } }) : new Response(null, { status: 404 });
      }
      assert.match(String(input), /^http:\/\/127\.0\.0\.1:/, 'No outbound requests are permitted in this fixture test');
      return original.fetch(input, options);
    };
    const app = express(); app.use(express.json()); app.use('/api/payments', paymentRoutes); app.use(errorHandler);
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}`;
    const token = id => jwt.sign({ id, authVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const request = (path, { id = 1, ...options } = {}) => fetch(url + path, { ...options, headers: { ...(id ? { Authorization: `Bearer ${token(id)}` } : {}), ...options.headers } });
    const upload = async (buffers, { preview = false, id = 2, type = 'BDO' } = {}) => {
      const body = new FormData(); body.append('paymentPurpose', 'COMBINED');
      if (type != null) body.append('receiptType', type);
      buffers.forEach((buffer, i) => body.append('receipt', new Blob([buffer], { type: 'image/png' }), `part-${i + 1}.png`));
      const response = await request(`/api/payments/bills/100${preview ? '/preview' : ''}`, { method: 'POST', body, id });
      return { status: response.status, data: await response.json() };
    };
    const first = await makeReceipt('BDO\nSent!\nPHP 500.00\nService Fee PHP 0.00\nTotal Amount PHP 500.00\nTo Example Recipient\nFrom Example Sender', 'Part one');
    const second = await makeReceipt('BDO\nCreated on\nNov 12, 2026 12:03 AM\nReference no.\nBN-20261112-12345678\nInvoice no.\n123456', 'Part two');
    assert.equal((await upload([first, first], { preview: true })).status, 400);
    assert.equal((await upload([first, second], { id: 3, preview: true })).status, 404);
    assert.equal((await upload([first, second], { type: 'INVALID', preview: true })).status, 400);
    const tiny = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#fff' } }).png().toBuffer();
    const poor = await upload([first, tiny], { preview: true });
    assert.equal(poor.status, 422); assert.equal(poor.data.analysis.quality.imagePosition, 2); assert.equal(uploaded, 0);

    const submitted = await upload([first, second]);
    assert.equal(submitted.status, 201, JSON.stringify(submitted.data));
    assert.deepEqual([submitted.data.analysis.amount, submitted.data.analysis.referenceNo, submitted.data.analysis.paymentDate], [500, 'BN-20261112-12345678', '2026-11-12']);
    const paymentId = submitted.data.paymentId;
    const detail = await (await request(`/api/payments/${paymentId}`)).json();
    assert.equal(detail.payment.receiptImages.length, 2); assert.equal(detail.payment.receiptType, 'BDO');
    assert.equal(detail.payment.reviewStatus, 'PENDING');
    assert.equal(JSON.stringify(detail.payment.receiptImages).includes('fixture/'), false);
    for (const [index, buffer] of [first, second].entries()) {
      const path = `/api/payments/${paymentId}/receipts/${detail.payment.receiptImages[index].id}`;
      const allowed = await request(path, { id: 2 });
      assert.equal(allowed.status, 200); assert.equal(allowed.headers.get('cache-control'), 'private, no-store');
      assert.deepEqual(Buffer.from(await allowed.arrayBuffer()), buffer);
      assert.equal((await request(path, { id: 3 })).status, 404);
      assert.equal((await request(path, { id: 4 })).status, 404);
      assert.equal((await request(path, { id: null })).status, 401);
    }
    const legacyDetail = await (await request(`/api/payments/${legacy}`)).json();
    assert.equal(legacyDetail.payment.receiptImages.length, 1);
    assert.equal((await request(`/api/payments/${legacy}/receipts/${detail.payment.receiptImages[1].id}`)).status, 404);
    assert.deepEqual(Buffer.from(await (await request(`/api/payments/${legacy}/receipt`)).arrayBuffer()), legacyBuffer);
    assert.deepEqual(Buffer.from(await (await request(`/api/payments/${paymentId}/receipt`)).arrayBuffer()), first);
    for (const buffers of [[second, first], [second], [legacyBuffer]]) assert.equal((await upload(buffers)).status, 409);
    t.diagnostic('PASS combined OCR, private per-image access, legacy endpoint, repeated-image and reverse-order duplicates');

    const extraFirst = await makeReceipt('BDO\nAmount PHP 600.00\nReference no. BN-20261112-55555555\nNov 12, 2026', 'Retry first');
    const extraSecond = await makeReceipt('BDO\nAmount PHP 600.00\nReference no. BN-20261112-55555555\nNov 12, 2026', 'Retry second');
    const snapshot = async () => ({ payments: (await db.query('SELECT COUNT(*)::int AS n FROM payment_submissions')).rows[0].n,
      images: (await db.query('SELECT COUNT(*)::int AS n FROM payment_receipt_images')).rows[0].n, stored: stored.size });
    const snapshotBefore = await snapshot();
    failUploadAt = uploaded + 2;
    assert.equal((await upload([extraFirst, extraSecond])).status, 500);
    failUploadAt = 0;
    assert.deepEqual(await snapshot(), snapshotBefore);
    failSecondImageInsert = true;
    assert.equal((await upload([extraFirst, extraSecond])).status, 500);
    failSecondImageInsert = false;
    assert.deepEqual(await snapshot(), snapshotBefore);
    assert.ok(deleted.length >= 3);
    t.diagnostic('PASS failed second upload and database rollback remove all new private images');

    // The legacy API may omit receiptType, but still receives Other safely.
    const legacyClient = await upload([extraFirst], { type: null });
    assert.equal(legacyClient.status, 201, JSON.stringify(legacyClient.data));
    assert.equal(legacyClient.data.analysis.receiptType, 'OTHER');
    const approval = await request(`/api/payments/${legacyClient.data.paymentId}/review`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'APPROVED', verifiedAmount: 600,
        paymentMethod: 'BANK_TRANSFER', verifiedReferenceNo: 'BN-20261112-55555555', verifiedPaymentDate: '2026-11-12' }) });
    assert.equal(approval.status, 200, await approval.text());
    assert.equal((await request(`/api/payments/${legacyClient.data.paymentId}/receipt`, { id: 4 })).status, 200);
    assert.equal((await request(`/api/payments/${paymentId}`, { method: 'DELETE' })).status, 409);
    await db.query("UPDATE payment_submissions SET review_status='REJECTED',reviewed_by=1,reviewed_at=NOW(),remarks='Fixture rejection' WHERE id=$1", [paymentId]);
    assert.equal((await request(`/api/payments/${paymentId}`, { method: 'DELETE' })).status, 200);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM payment_receipt_images WHERE payment_submission_id=$1', [paymentId])).rows[0].n, 0);
    assert.equal((await request(`/api/payments/${paymentId}/receipt`)).status, 404);
    assert.ok(stored.has('fixture/legacy'));
    t.diagnostic('PASS older-client submission, deletion rules and multi-image cleanup');
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    pool.query = original.query; pool.connect = original.connect; globalThis.fetch = original.fetch;
    cloudinary.uploader.upload_stream = original.upload; cloudinary.uploader.destroy = original.destroy;
    for (const key of ['JWT_SECRET', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) {
      if (environment[key] == null) delete process.env[key]; else process.env[key] = environment[key];
    }
    await db.close(); await pool.end();
  }
});
