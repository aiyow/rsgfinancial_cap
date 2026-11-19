import { randomUUID } from 'node:crypto';
import pool from '../config/db.js';
import { analyzeReceiptImages } from './receiptBatches.js';
import { MAX_RECEIPT_BYTES, receiptDeliveryUrl } from './receipts.js';

const MAX_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 3000;

async function claimReceipt(db) {
  const token = randomUUID();
  const result = await db.query(`
    WITH next_job AS (
      SELECT id FROM payment_submissions
      WHERE ocr_status IN ('QUEUED', 'PROCESSING') AND ocr_available_at <= NOW()
      ORDER BY ocr_available_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    UPDATE payment_submissions p
    SET ocr_status = 'PROCESSING', ocr_attempts = p.ocr_attempts + 1,
        ocr_available_at = NOW() + INTERVAL '8 minutes', ocr_claim_token = $1
    FROM next_job WHERE p.id = next_job.id
    RETURNING p.id, p.receipt_type AS "receiptType", p.ocr_attempts AS attempts, p.ocr_claim_token AS token`, [token]);
  return result.rows[0];
}

async function readImage(image) {
  const response = await fetch(receiptDeliveryUrl(image.publicId), { signal: AbortSignal.timeout(20_000) });
  if (!response.ok || !response.body) throw new Error('Stored receipt could not be read.');
  const parts = [];
  let bytes = 0;
  for await (const part of response.body) {
    bytes += part.length;
    if (bytes > MAX_RECEIPT_BYTES) throw new Error('Stored receipt exceeds the upload limit.');
    parts.push(part);
  }
  return Buffer.concat(parts, bytes);
}

async function completeReceipt(db, job, images, analysis) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Admin may review while OCR runs. This update writes OCR columns only and
    // a worker whose lease expired cannot overwrite a newer job's result.
    const saved = await client.query(`
      UPDATE payment_submissions SET ocr_status = 'COMPLETED',
        ocr_available_at = NULL, ocr_claim_token = NULL, ocr_raw_text = $3,
        ocr_confidence = $4, ocr_quality_status = $5, ocr_amount = $6, ocr_reference_no = $7,
        ocr_payment_date = $8, ocr_details = $9::jsonb
      WHERE id = $1 AND ocr_status = 'PROCESSING' AND ocr_claim_token = $2
      RETURNING id`, [job.id, job.token, analysis.rawText, analysis.confidence,
      analysis.quality.status, analysis.amount, analysis.referenceNo, analysis.paymentDate,
      JSON.stringify({ detectedReceiptType: analysis.detectedReceiptType, warnings: analysis.warnings,
        additionalReferences: analysis.additionalReferences })]);
    if (saved.rows.length > 0) {
      for (const [index, image] of images.entries()) {
        await client.query('UPDATE payment_receipt_images SET ocr_analysis = $2::jsonb WHERE id = $1',
          [image.id, JSON.stringify(analysis.images[index])]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function rescheduleReceipt(db, job) {
  const retry = job.attempts < MAX_ATTEMPTS;
  await db.query(`
    UPDATE payment_submissions SET ocr_status = $3, ocr_claim_token = NULL,
      ocr_available_at = CASE WHEN $3 = 'QUEUED' THEN NOW() + ($4::int * INTERVAL '1 second') ELSE NULL END
    WHERE id = $1 AND ocr_status = 'PROCESSING' AND ocr_claim_token = $2`,
  [job.id, job.token, retry ? 'QUEUED' : 'FAILED', 15 * job.attempts]);
}

export async function processReceiptOcrJob({ db = pool, loadImage = readImage, analyze = analyzeReceiptImages } = {}) {
  const job = await claimReceipt(db);
  if (!job) return false;
  // One additional claim after an expired final lease resolves an interrupted job.
  if (job.attempts > MAX_ATTEMPTS) {
    await rescheduleReceipt(db, job);
    return true;
  }
  try {
    const { rows: images } = await db.query(`
      SELECT id, cloudinary_public_id AS "publicId"
      FROM payment_receipt_images WHERE payment_submission_id = $1 ORDER BY position`, [job.id]);
    if (!images.length || images.some(image => !image.publicId)) throw new Error('No stored receipt to scan.');
    const files = [];
    for (const image of images) files.push({ buffer: await loadImage(image) });
    const analysis = await analyze(files, job.receiptType, undefined, { timeoutMs: 180_000 });
    await completeReceipt(db, job, images, analysis);
  } catch (error) {
    console.warn('Background receipt OCR failed', { paymentId: job.id, attempt: job.attempts, code: error.code || error.name });
    await rescheduleReceipt(db, job);
  }
  return true;
}

export function startReceiptOcrQueue() {
  let running = false;
  let migrationReported = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      await processReceiptOcrJob();
      migrationReported = false;
    } catch (error) {
      if (error.code !== '42703' || !migrationReported) {
        console.error('Background receipt OCR queue unavailable', { code: error.code });
        migrationReported = error.code === '42703';
      }
    } finally { running = false; }
  }
  setInterval(tick, POLL_INTERVAL_MS).unref();
  void tick();
}
