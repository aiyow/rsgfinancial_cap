import sharp from "sharp";
import { createWorker } from "tesseract.js";

const MIN_WIDTH = 600;
const MIN_HEIGHT = 600;
const BLUR_THRESHOLD = 45;
const monthMap = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function normalizedText(text) {
  return text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/£/g, "P")
    .replace(/\bIul\b/gi, "Jul")
    .replace(/\bJu1\b/g, "Jul")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAmount(text) {
  const patterns = [
    /(?:amount(?:\s+paid)?|total)\s*[:\-]?\s*(?:php|₱|p)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:php|₱)\s*([\d,]+(?:\.\d{1,2})?)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = Number(match[1].replace(/,/g, ""));
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return null;
}

function parseReference(text) {
  const compact = normalizedText(text);
  const match = compact.match(
    /(?:reference|ref(?:erence)?)(?:\s*(?:no|number|#|no\.))?\s*[:#\-]?\s*([a-z0-9][a-z0-9\s-]{5,}?)(?=\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b|\s*$)/i,
  ) || compact.match(
    /transaction\s*(?:id|no|number)\s*[:#\-]?\s*([a-z0-9][a-z0-9\s-]{5,})/i,
  );
  if (!match) return null;
  const cleaned = match[1].replace(/\s+/g, " ").trim();
  const digitsOnly = cleaned.replace(/[^\d]/g, "");
  return digitsOnly.length >= 6 ? digitsOnly : cleaned;
}

function validDate(year, month, day) {
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) return null;
  return value.toISOString().slice(0, 10);
}

function parseDate(text) {
  const compact = normalizedText(text);
  let match = compact.match(/\b(20\d{2})[\/-](0?[1-9]|1[0-2])[\/-](0?[1-9]|[12]\d|3[01])\b/);
  if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = compact.match(/\b(0?[1-9]|1[0-2])[\/-](0?[1-9]|[12]\d|3[01])[\/-](20\d{2})\b/);
  if (match) return validDate(Number(match[3]), Number(match[1]), Number(match[2]));
  match = compact.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s+(20\d{2})\b/i);
  if (match) return validDate(Number(match[3]), monthMap[match[1].toLowerCase()], Number(match[2]));
  return null;
}

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

export async function analyzeReceipt(buffer) {
  const quality = await imageQuality(buffer);
  if (quality.status !== "GOOD") return { quality, rawText: "", confidence: null, amount: null, referenceNo: null, paymentDate: null, complete: false };

  const worker = await createWorker("eng");
  try {
    const result = await worker.recognize(buffer);
    const rawText = result.data.text.trim();
    const amount = parseAmount(rawText);
    const referenceNo = parseReference(rawText);
    const paymentDate = parseDate(rawText);
    return {
      quality,
      rawText,
      confidence: Number(result.data.confidence.toFixed(2)),
      amount,
      referenceNo,
      paymentDate,
      complete: Boolean(amount && referenceNo && paymentDate),
    };
  } finally {
    await worker.terminate();
  }
}
