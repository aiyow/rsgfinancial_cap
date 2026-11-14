import sharp from 'sharp';
import { createWorker, PSM } from 'tesseract.js';
import crypto from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';

// Receipts service. Fold the region sections to navigate related code.
// 1. Receipt file policy
// 2. Receipt text parsing
// 3. Receipt image analysis and OCR
// 4. Private receipt storage

// #region Receipt file policy

// Browser and API deployments have independent roots; keep these copies identical.
export const RECEIPT_EXTENSIONS = ['.jpg', '.jpeg', '.jfif', '.png'];
export const RECEIPT_ACCEPT = RECEIPT_EXTENSIONS.join(',');
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
export const MAX_RECEIPT_IMAGES = 2;
export const RECEIPT_TYPES = { GCASH: 'GCash', GOTYME: 'GoTyme', MARIBANK: 'MariBank', BDO: 'BDO', BPI: 'BPI', MAYA: 'Maya', OTHER: 'Other' };
export const RECEIPT_TYPE_MESSAGE = 'Only JPEG/JPG (.jpg, .jpeg, .jfif) or PNG (.png) receipt images are accepted.';

export function receiptExtension(name) {
  if (typeof name !== 'string') return '';
  const extension = name.slice(name.lastIndexOf('.')).toLowerCase();
  return RECEIPT_EXTENSIONS.includes(extension) ? extension : '';
}

export function receiptFileError(file) {
  if (!file) return 'Choose a JPEG/JPG (.jpg, .jpeg, .jfif) or PNG (.png) receipt image first.';
  if (!receiptExtension(file.name)) return RECEIPT_TYPE_MESSAGE;
  if (!Number.isFinite(file.size) || file.size <= 0) return 'The receipt image is empty. Choose another image.';
  if (file.size > MAX_RECEIPT_BYTES) return 'Receipt images must be 5 MB or smaller.';
  return '';
}

// #endregion

// #region Receipt text parsing

// Preserve the transcription. Field-specific cleanup must not rewrite names or masks.
export function normalizeReceiptText(text = '') {
  return text.replace(/\r\n?/g, '\n').split('\n')
    .map((line) => line.replace(/[\t \u00a0]+/g, ' ').trim())
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function parseAmount(text, receiptType) {
  // OCR may replace a thousands comma with a space. Consume the entire money
  // token so "1 500.00" cannot silently become 1 (or a malformed 1,50 become 50).
  const value = String.raw`([0-9]{1,3}(?:(?:,[ \t]*|[ \t])[0-9]{3})+(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)(?![0-9.,]|[ \t]+[0-9])`;
  const suffix = String.raw`\s*(?:[:=]\s*|-\s+)?(PHP|[₱P£$])?\s*${value}`;
  const labeledAmount = (label, prefix = String.raw`\b`) => {
    const match = text.match(new RegExp(`${prefix}${label}${suffix}`, 'i'));
    if (!match) return null;
    const amount = Number(match[2].replace(/[, \t]/g, ''));
    return { amount, currency: match[1], token: match[2] };
  };
  // GCash shows an outgoing payment as a negative debit in transaction details.
  if (receiptType === 'GCASH') {
    const debit = text.match(new RegExp(String.raw`(?:^|\n)amount[ \t]*[:=]?[ \t]*-\s*${value}`, 'i'));
    if (debit) return Number(debit[1].replace(/[, \t]/g, '')) || null;
  }
  // The recipient receives the principal, not the sender's bank fee.
  for (const label of [String.raw`transfer\s+amount`, String.raw`amount\s+(?:sent|paid)`, 'amount']) {
    const match = labeledAmount(label, String.raw`(?:^|\n)[ \t]*`);
    if (match) return Number.isFinite(match.amount) && match.amount > 0 ? match.amount : null;
  }
  const sent = text.match(new RegExp(String.raw`\b(?:you\s+have\s+sent|you\s+sent)\s+(?:PHP|₱)\s*${value}`, 'i'));
  if (sent) return Number(sent[1].replace(/[, \t]/g, '')) || null;
  for (const label of [String.raw`total\s+amount\s+sent`, String.raw`total\s+amount(?:\s+paid)?`, 'total']) {
    const match = labeledAmount(label);
    if (!match) continue;
    if (!Number.isFinite(match.amount) || match.amount <= 0) return null;
    const fee = labeledAmount(String.raw`(?:(?:service|transfer)\s+)?fee`);
    const amount = Math.round((match.amount - (fee?.amount || 0)) * 100) / 100;
    return amount > 0 ? amount : null;
  }
  const header = text.split('\n').filter(line => !/\b(?:fee|balance|referral|up to|reference|acct|account)\b/i.test(line)).join('\n');
  const match = header.match(new RegExp(String.raw`(?:PHP|₱)\s*${value}`, 'i'));
  const amount = match ? Number(match[1].replace(/[, \t]/g, '')) : null;
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function parseReference(text) {
  const match = text.match(/\b(?:(?:transaction\s+)?ref(?:erence)?\b\.?\s*(?:number|no\.?|#)?|transaction\s*(?:id|number|no\.?))\s*[:#]?\s*([^\n]+)/i);
  if (!match) return null;
  // Stop at a neighboring date/label, including dates on the same printed row.
  const candidate = match[1].split(/\s+(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|20\d{2}[-/]\d|\d{1,2}[-/]\d{1,2}[-/]20\d{2}|(?:date|time|amount|sent|paid|total)\b)/i)[0].trim().replace(/[.,;:]+$/, '');
  if (/^\d[\d -]*$/.test(candidate)) {
    const digits = candidate.replace(/[ -]/g, '');
    return digits.length >= 6 && digits.length <= 40 ? digits : null;
  }
  // Some banks use alphanumeric IDs. Never silently strip their letters.
  return /^[a-z0-9][a-z0-9-]{5,39}$/i.test(candidate) && /\d/.test(candidate) ? candidate : null;
}

function validDate(year, month, day) {
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day
    ? value.toISOString().slice(0, 10) : null;
}

function parseDate(text) {
  let match = text.match(/\b(20\d{2})[/-](\d{1,2})[/-](\d{1,2})\b/);
  if (match) return validDate(+match[1], +match[2], +match[3]);
  match = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
  if (match) return validDate(+match[3], +match[1], +match[2]);
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  match = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:\s*,\s*|\s+)(20\d{2})\b/i);
  if (match) return validDate(+match[3], months.indexOf(match[1].toLowerCase()) + 1, +match[2]);
  match = text.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(20\d{2})\b/i);
  return match ? validDate(+match[3], months.indexOf(match[2].toLowerCase()) + 1, +match[1]) : null;
}

export function detectReceiptType(text) {
  // Source-bank anchors take precedence over recipient names such as GCash.
  const header = text.split(/\b(?:from|to)\b/i)[0];
  const sender = text.match(/\bfrom\b([\s\S]*?)(?=\b(?:to|amount|total|notes)\b|$)/i)?.[1] || '';
  if (/\bMari\s*Bank\b/i.test(header + '\n' + sender) || /receipt generated from MariBank app/i.test(text)) return 'MARIBANK';
  if (/\bGo\s*Tyme(?:\s+Bank)?\b/i.test(header + '\n' + sender)) return 'GOTYME';
  if (/\bsent\s+via\s+BPI\b/i.test(text)) return 'BPI';
  if (/\bBDO\b|\bBN-20\d{6}-\d+\b/i.test(text)) return 'BDO';
  if (/\b(?:Express\s+Send|GCash)\b/i.test(header) || /\bGCash\b/i.test(sender)) return 'GCASH';
  if (/receipt generated from.*Maya|sent (?:via|with) Maya/i.test(text)) return 'MAYA';
  return null;
}

export function parseReceiptText(text, receiptType = 'OTHER') {
  const normalized = normalizeReceiptText(text);
  return { amount: parseAmount(normalized, receiptType === 'OTHER' ? detectReceiptType(normalized) : receiptType), referenceNo: parseReference(normalized), paymentDate: parseDate(normalized) };
}

// A disagreement between OCR passes needs human review, not a guessed payment value.
export function reconcileReceiptFields(candidates) {
  return Object.fromEntries(['amount', 'referenceNo', 'paymentDate'].map((key) => {
    const values = [...new Set(candidates.map((candidate) => candidate[key]).filter((value) => value !== null))];
    return [key, values.length === 1 ? values[0] : null];
  }));
}

// #endregion

// #region Receipt image analysis and OCR

const MIN_WIDTH = 600;
const MIN_HEIGHT = 600;
const BLUR_THRESHOLD = 20;

async function imageQuality(buffer) {
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (width < MIN_WIDTH || height < MIN_HEIGHT) return { status: "LOW_RESOLUTION", width, height, blurScore: 0 };

  const { data } = await sharp(buffer)
    .greyscale()
    .resize({ width: Math.min(width, 1200), withoutEnlargement: true })
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let sum = 0;
  let squareSum = 0;
  for (const value of data) { sum += value; squareSum += value * value; }
  const mean = sum / data.length;
  const blurScore = squareSum / data.length - mean * mean;
  return { status: blurScore < BLUR_THRESHOLD ? "BLURRY" : "GOOD", width, height, blurScore: Number(blurScore.toFixed(2)) };
}


// Use word coordinates to put side-by-side labels and values on the same line.
function readRows(data) {
  const lines = (data.blocks || []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines))
    .filter((line) => /[\p{L}\p{N}]/u.test(line.text))
    .sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  const rows = [];
  for (const line of lines) {
    const box = line.bbox;
    const center = (box.y0 + box.y1) / 2;
    const row = rows.find((item) => Math.abs((item.bbox.y0 + item.bbox.y1) / 2 - center)
      < Math.min(item.bbox.y1 - item.bbox.y0, box.y1 - box.y0) * 0.5);
    if (row) {
      row.parts.push(line);
      row.bbox = { x0: Math.min(row.bbox.x0, box.x0), y0: Math.min(row.bbox.y0, box.y0),
        x1: Math.max(row.bbox.x1, box.x1), y1: Math.max(row.bbox.y1, box.y1) };
    } else rows.push({ bbox: { ...box }, parts: [line] });
  }
  return rows.map((row) => {
    const parts = row.parts.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    const count = parts.reduce((sum, part) => sum + part.text.trim().length, 0);
    return { bbox: row.bbox, text: parts.map((part) => part.text.trim()).join(' '), words: parts.flatMap(part => part.words || []),
      confidence: parts.reduce((sum, part) => sum + part.confidence * part.text.trim().length, 0) / Math.max(count, 1) };
  });
}

function sameRow(a, b) {
  const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return overlap > Math.min(a.y1 - a.y0, b.y1 - b.y0) * 0.6
    && Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0);
}

// Detect round, mid-height mask dots from pixels; ordinary decimal points sit
// at the baseline. Only accept a line if it contains a repeated mask pattern.
function privacyDots(pixels, width, box) {
  const left = Math.floor(box.x0), top = Math.floor(box.y0);
  const w = Math.ceil(box.x1) - left, h = Math.ceil(box.y1) - top;
  const visited = new Uint8Array(w * h);
  const dots = [];
  for (let i = 0; i < visited.length; i++) {
    if (visited[i]) continue;
    visited[i] = 1;
    if (pixels[(top + Math.floor(i / w)) * width + left + i % w] >= 150) continue;
    const stack = [i];
    let x0 = w, x1 = 0, y0 = h, y1 = 0, area = 0;
    while (stack.length) {
      const index = stack.pop(), x = index % w, y = Math.floor(index / w);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y); area++;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (visited[n]) continue;
        visited[n] = 1;
        if (pixels[(top + ny) * width + left + nx] < 150) stack.push(n);
      }
    }
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const center = (y0 + y1) / (2 * h);
    if (ch >= h * 0.15 && ch <= h * 0.55 && cw / ch >= 0.75 && cw / ch <= 1.35
      && center > 0.3 && center < 0.75 && area / (cw * ch) > 0.55) {
      dots.push({ x0: left + x0, x1: left + x1 + 1, width: cw });
    }
  }
  dots.sort((a, b) => a.x0 - b.x0);
  return dots.some((dot, i) => i > 0 && dot.x0 - dots[i - 1].x1 < Math.max(dot.width, dots[i - 1].width) * 2)
    ? dots : [];
}

async function restoreMask(worker, image, row, dots) {
  let start = row.bbox.x0;
  const pieces = [];
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
  for (const dot of [...dots, { x0: row.bbox.x1, end: true }]) {
    if (dot.x0 - start > 3) {
      const fragment = await sharp(image).extract({ left: start, top: row.bbox.y0,
        width: dot.x0 - start, height: row.bbox.y1 - row.bbox.y0 })
        .extend({ top: 12, bottom: 12, left: 12, right: 12, background: 'white' }).png().toBuffer();
      const { data } = await worker.recognize(fragment);
      const text = normalizeReceiptText(data.text);
      if (text) pieces.push(text);
    }
    if (!dot.end) pieces.push('•');
    start = dot.x1;
  }
  return pieces.join('');
}

export function referenceValueWords(words) {
  const numeric = words.filter(word => /\d/.test(word.text));
  if (!numeric.length) return [];
  const first = numeric.find(word => /[a-z0-9-]{6,}/i.test(word.text)) || numeric[0];
  const height = first.bbox.y1 - first.bbox.y0;
  const center = (first.bbox.y0 + first.bbox.y1) / 2;
  return numeric.filter(word => {
    if (word.bbox.x0 < first.bbox.x0) return false;
    if (word === first || word.text.replace(/\D/g, '').length >= 3) return true;
    // Keep real one/two-digit fragments at the same text size and baseline.
    // A copy icon is taller and extends above/below the printed reference.
    const h = word.bbox.y1 - word.bbox.y0;
    return h >= height * 0.65 && h <= height * 1.4
      && Math.abs((word.bbox.y0 + word.bbox.y1) / 2 - center) <= height * 0.3;
  });
}

// Reread just the printed ID. A neighboring copy icon can otherwise become a
// trailing zero, and whole-page thresholding can confuse an initial I with 1.
async function rereadReference(worker, oriented, rows, scale) {
  for (let i = 0; i < rows.length; i++) {
    if (!/\b(?:ref(?:erence)?\.?\s*(?:no\.?|number)?|transaction\s+id)\b/i.test(rows[i].text)) continue;
    let row = rows[i];
    let words = (row.words || []).filter(word => /\d/.test(word.text));
    if (!words.length && rows[i + 1] && rows[i + 1].bbox.y0 - row.bbox.y1 < (row.bbox.y1 - row.bbox.y0) * 4) {
      row = rows[i + 1];
      words = (row.words || []).filter(word => /\d/.test(word.text));
    }
    if (!words.length) continue;
    const selected = referenceValueWords(words);
    const first = selected[0];
    const box = { x0: first.bbox.x0, y0: Math.min(...selected.map(w => w.bbox.y0)),
      x1: Math.max(...selected.map(w => w.bbox.x1)), y1: Math.max(...selected.map(w => w.bbox.y1)) };
    const meta = await sharp(oriented).metadata();
    const left = Math.max(0, Math.floor(box.x0 / scale) - 2), top = Math.max(0, Math.floor(box.y0 / scale) - 2);
    const width = Math.min(meta.width - left, Math.ceil((box.x1 - box.x0) / scale) + 4);
    const height = Math.min(meta.height - top, Math.ceil((box.y1 - box.y0) / scale) + 4);
    const crop = await sharp(oriented).extract({ left, top, width, height }).resize({ height: Math.max(80, height * 2) })
      .extend({ top: 16, bottom: 16, left: 16, right: 16, background: 'white' }).png().toBuffer();
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
    const { data } = await worker.recognize(crop);
    const referenceNo = parseReference(`Reference No. ${normalizeReceiptText(data.text)}`);
    if (referenceNo && data.confidence >= 60) return referenceNo;
  }
  return null;
}

export async function analyzeReceipt(buffer, receiptType = 'OTHER') {
  // Honor EXIF orientation before quality assessment, preprocessing, and coordinates.
  const oriented = await sharp(buffer).rotate().flatten({ background: '#ffffff' }).png().toBuffer();
  const quality = await imageQuality(oriented);
  if (quality.status !== "GOOD") {
    return { quality, rawText: "", confidence: null, amount: null, referenceNo: null, paymentDate: null, complete: false };
  }
  const scale = Math.min(2, 1800 / quality.width, 4096 / quality.height);
  const image = await sharp(oriented).resize({ width: Math.round(quality.width * scale) })
    .greyscale().normalise().png().toBuffer();
  const binary = await sharp(image).threshold(165).png().toBuffer();
  const worker = await createWorker("eng");
  try {
    await worker.setParameters({ user_defined_dpi: '300', preserve_interword_spaces: '1',
      tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const first = (await worker.recognize(image, {}, { text: true, blocks: true })).data;
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    const second = (await worker.recognize(binary, {}, { text: true, blocks: true })).data;
    const firstRows = readRows(first), secondRows = readRows(second);
    const rows = firstRows.map((row) => {
      const other = secondRows.find((item) => sameRow(item.bbox, row.bbox));
      return other && other.confidence > row.confidence ? other : row;
    });
    for (const row of secondRows) {
      if (!rows.some((item) => sameRow(item.bbox, row.bbox)) && row.confidence >= 60) rows.push(row);
    }
    rows.sort((a, b) => a.bbox.y0 - b.bbox.y0);
    const { data: pixels, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
    let masksRecovered = 0;
    for (const row of rows) {
      if (row.confidence >= 80 || masksRecovered >= 4) continue;
      const dots = privacyDots(pixels, info.width, row.bbox);
      if (dots.length) {
        row.text = await restoreMask(worker, image, row, dots);
        masksRecovered++;
      }
    }
    const rawText = normalizeReceiptText(rows.length ? rows.map((row) => row.text).join('\n') : first.text);
    const candidates = [
      parseReceiptText(firstRows.map((row) => row.text).join('\n') || first.text, receiptType),
      parseReceiptText(secondRows.map((row) => row.text).join('\n') || second.text, receiptType),
    ];
    const fields = reconcileReceiptFields(candidates);
    let focusedReference = await rereadReference(worker, oriented, rows, scale);
    // GoTyme's IT reference has a numeric body. Correct an O in that body only
    // when another full-page pass independently printed the exact numeric ID.
    if ((receiptType === 'GOTYME' || detectReceiptType(rawText) === 'GOTYME') && /^IT[0-9O]{6,38}$/i.test(focusedReference || '')) {
      const numericBody = 'IT' + focusedReference.slice(2).replace(/o/gi, '0');
      if (candidates.some(candidate => candidate.referenceNo === numericBody)) focusedReference = numericBody;
    }
    // A focused, spatially bounded reading must agree with at least one page
    // pass (or its printed value before a separate icon) before resolving it.
    if (focusedReference && candidates.some(c => c.referenceNo === focusedReference
      || (c.referenceNo === focusedReference + '0' && /\bReference Number\b/i.test(rawText)))) {
      fields.referenceNo = focusedReference;
    }
    const characters = rows.reduce((sum, row) => sum + row.text.length, 0);
    const confidence = characters
      ? rows.reduce((sum, row) => sum + row.confidence * row.text.length, 0) / characters
      : first.confidence;
    const confirmationNo = rawText.match(/\bconfirmation\s+no\.?\s*[:#]?\s*(\d{6,40})/i)?.[1];
    const warnings = ['amount', 'referenceNo', 'paymentDate'].filter(key => new Set(candidates.map(c => c[key]).filter(v => v != null)).size > 1 && fields[key] == null)
      .map(key => `The ${({ amount: 'amount', referenceNo: 'reference number', paymentDate: 'payment date' })[key]} could not be read consistently. Admin will check the receipt.`);
    const detectedReceiptType = detectReceiptType(rawText);
    return { quality, rawText, confidence: Number(confidence.toFixed(2)), ...fields, detectedReceiptType, warnings,
      additionalReferences: confirmationNo ? { confirmationNo } : {},
      complete: Boolean(fields.amount && fields.referenceNo && fields.paymentDate) };
  } finally {
    await worker.terminate();
  }
}

// #endregion

// #region Private receipt storage

function configurationError() {
  const error = new Error("Cloudinary receipt storage is not configured.");
  error.code = "CLOUDINARY_NOT_CONFIGURED";
  return error;
}

export function createReceiptService({ client = cloudinary, environment = process.env, createId = crypto.randomUUID } = {}) {
  function settings() {
    const cloudName = environment.CLOUDINARY_CLOUD_NAME?.trim();
    const apiKey = environment.CLOUDINARY_API_KEY?.trim();
    const apiSecret = environment.CLOUDINARY_API_SECRET?.trim();
    const folder = (environment.CLOUDINARY_RECEIPTS_FOLDER || "rsg-condo/payment-receipts")
      .trim()
      .replace(/^\/+|\/+$/g, "");

    if (!cloudName || !apiKey || !apiSecret || !folder) throw configurationError();

    client.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
    return { folder };
  }

  function uploadReceipt(buffer) {
    const { folder } = settings();
    return new Promise((resolve, reject) => {
      const stream = client.uploader.upload_stream(
        {
          resource_type: "image",
          type: "authenticated",
          folder,
          public_id: createId(),
          unique_filename: false,
          overwrite: false,
        },
        (error, result) => {
          if (error) return reject(error);
          if (!result?.public_id) return reject(new Error("Cloudinary did not return a receipt public ID."));
          return resolve({ publicId: result.public_id });
        },
      );
      stream.end(buffer);
    });
  }

  async function destroyReceipt(publicId) {
    settings();
    if (!publicId) return { result: "not found" };
    return client.uploader.destroy(publicId, {
      resource_type: "image",
      type: "authenticated",
      invalidate: true,
    });
  }

  function receiptDeliveryUrl(publicId) {
    settings();
    if (!publicId) throw new Error("Cloudinary receipt public ID is missing.");
    return client.url(publicId, {
      resource_type: "image",
      type: "authenticated",
      sign_url: true,
      secure: true,
    });
  }

  return { uploadReceipt, destroyReceipt, receiptDeliveryUrl };
}

const receiptService = createReceiptService();
export const uploadReceipt = (...args) => receiptService.uploadReceipt(...args);
export const destroyReceipt = (...args) => receiptService.destroyReceipt(...args);
export const receiptDeliveryUrl = (...args) => receiptService.receiptDeliveryUrl(...args);

// #endregion
