import sharp from "sharp";
import { createWorker, PSM } from "tesseract.js";
import { normalizeReceiptText, parseReceiptText, reconcileReceiptFields } from "./receiptText.js";

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
    return { bbox: row.bbox, text: parts.map((part) => part.text.trim()).join(' '),
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

export async function analyzeReceipt(buffer) {
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
    const fields = reconcileReceiptFields([
      parseReceiptText(firstRows.map((row) => row.text).join('\n') || first.text),
      parseReceiptText(secondRows.map((row) => row.text).join('\n') || second.text),
    ]);
    const characters = rows.reduce((sum, row) => sum + row.text.length, 0);
    const confidence = characters
      ? rows.reduce((sum, row) => sum + row.confidence * row.text.length, 0) / characters
      : first.confidence;
    return { quality, rawText, confidence: Number(confidence.toFixed(2)), ...fields,
      complete: Boolean(fields.amount && fields.referenceNo && fields.paymentDate) };
  } finally {
    await worker.terminate();
  }
}
