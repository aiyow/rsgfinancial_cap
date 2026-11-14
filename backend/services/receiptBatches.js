import crypto from 'node:crypto';
import { analyzeReceipt, destroyReceipt, RECEIPT_TYPES, reconcileReceiptFields, uploadReceipt } from './receipts.js';

export async function ensureReceiptImagesSchema(client) {
  const result = await client.query("SELECT to_regclass('payment_receipt_images') AS images");
  if (!result.rows[0]?.images) throw Object.assign(new Error('Receipt image storage is not initialized. Run npm run receipts:migrate-images on the backend.'), { status: 503 });
}

export function receiptTypeFromRequest(value) {
  if (value == null) return 'OTHER'; // Installed older clients still submit one image.
  if (typeof value !== 'string' || !Object.hasOwn(RECEIPT_TYPES, value)) {
    throw Object.assign(new Error('Choose a valid receipt type.'), { status: 400 });
  }
  return value;
}

export const receiptHash = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

export function mergeReceiptAnalyses(images, receiptType = 'OTHER') {
  const fields = reconcileReceiptFields(images);
  const warnings = images.flatMap((image, index) => (image.warnings || []).map(message => `Image ${index + 1}: ${message}`));
  const labels = { amount: 'amount', referenceNo: 'reference number', paymentDate: 'payment date' };
  for (const key of Object.keys(labels)) {
    if (new Set(images.map(image => image[key]).filter(value => value != null)).size > 1) {
      warnings.push(`The images show different ${labels[key]} values. Please upload screenshots of the same payment. Admin must verify this field.`);
    }
  }
  const detected = [...new Set(images.map(image => image.detectedReceiptType).filter(Boolean))];
  if (detected.length > 1) warnings.push('The images appear to come from different banks or apps. Please check that both belong to the same payment.');
  const additionalReferences = {};
  for (const key of new Set(images.flatMap(image => Object.keys(image.additionalReferences || {})))) {
    const values = [...new Set(images.map(image => image.additionalReferences?.[key]).filter(Boolean))];
    if (values.length === 1) additionalReferences[key] = values[0];
    else warnings.push('The images contain different additional reference numbers. Admin will check both images.');
  }
  const failed = images.findIndex(image => image.quality.status !== 'GOOD');
  const confidences = images.map(image => image.confidence).filter(value => Number.isFinite(value));
  return {
    ...fields, receiptType, detectedReceiptType: detected.length === 1 ? detected[0] : null,
    quality: failed >= 0 ? { ...images[failed].quality, imagePosition: failed + 1 } : { status: 'GOOD' },
    confidence: confidences.length ? Number((confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(2)) : null,
    rawText: images.map((image, index) => `--- Image ${index + 1} ---\n${image.rawText}`).join('\n\n'),
    additionalReferences, warnings, images: images.map((image, index) => ({ ...image, position: index + 1 })),
    complete: failed < 0 && Boolean(fields.amount && fields.referenceNo && fields.paymentDate),
  };
}

export async function analyzeReceiptImages(files, receiptType, analyze = analyzeReceipt) {
  // Process serially to bound OCR memory use on the hosted backend.
  const images = [];
  for (const file of files) images.push(await analyze(file.buffer, receiptType));
  return mergeReceiptAnalyses(images, receiptType);
}

export async function cleanupReceiptImages(images, destroy = destroyReceipt) {
  const results = await Promise.allSettled(images.map(image => destroy(image.publicId)));
  results.forEach((result, i) => {
    if (result.status === 'rejected') console.error(`Receipt image cleanup failed (${images[i].publicId}):`, result.reason.message);
  });
}

export async function uploadReceiptImages(files, { upload = uploadReceipt, destroy = destroyReceipt } = {}) {
  const uploaded = [];
  try {
    for (const file of files) uploaded.push(await upload(file.buffer));
    return uploaded;
  } catch (error) {
    await cleanupReceiptImages(uploaded, destroy);
    throw error;
  }
}

// Ordered metadata only. Private image bytes are always retrieved through the API.
export const receiptImagesSelectSql = `COALESCE((SELECT jsonb_agg(jsonb_build_object(
  'id', image.id, 'position', image.position, 'originalName', image.original_name, 'mimeType', image.mime_type)
  ORDER BY image.position) FROM payment_receipt_images image WHERE image.payment_submission_id = ps.id), '[]'::jsonb)`;

export async function insertReceiptImages(client, paymentId, files, uploaded, analysis) {
  for (let index = 0; index < files.length; index++) {
    await client.query(`INSERT INTO payment_receipt_images
      (payment_submission_id, position, storage, path, cloudinary_public_id, original_name, mime_type, sha256, ocr_analysis)
      VALUES ($1,$2,'CLOUDINARY',$3,$3,$4,$5,$6,$7::jsonb)`,
    [paymentId, index + 1, uploaded[index].publicId, files[index].originalname.slice(0, 255), files[index].mimetype,
      receiptHash(files[index].buffer), JSON.stringify(analysis.images[index])]);
  }
}
