// Preserve the transcription. Field-specific cleanup must not rewrite names or masks.
export function normalizeReceiptText(text = '') {
  return text.replace(/\r\n?/g, '\n').split('\n')
    .map((line) => line.replace(/[\t \u00a0]+/g, ' ').trim())
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function parseAmount(text) {
  const value = '([0-9]+(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?)(?![0-9.,])';
  // Prefer the final total over a subtotal, fee, or unrelated number.
  for (const label of ['total\\s+amount\\s+sent', 'total\\s+amount(?:\\s+paid)?', 'amount\\s+(?:sent|paid)', 'amount', 'total']) {
    const match = text.match(new RegExp(`\\b${label}\\s*[:\\-]?\\s*(?:PHP|₱|P|£)?\\s*${value}`, 'i'));
    if (match) {
      const amount = Number(match[1].replaceAll(',', ''));
      return Number.isFinite(amount) && amount > 0 ? amount : null;
    }
  }
  const match = text.match(new RegExp(`(?:PHP|₱)\\s*${value}`, 'i'));
  const amount = match ? Number(match[1].replaceAll(',', '')) : null;
  return amount > 0 ? amount : null;
}

function parseReference(text) {
  const match = text.match(/\b(?:ref(?:erence)?(?:\s*(?:number|no\.?|#))?|transaction\s*(?:id|number|no\.?))\s*[:#\-]?\s*([^\n]+)/i);
  if (!match) return null;
  // Stop at a neighboring date/label, including dates on the same printed row.
  const candidate = match[1].split(/\s+(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|20\d{2}[-/]\d|\d{1,2}[-/]\d{1,2}[-/]20\d{2}|(?:date|time|amount|sent|paid|total)\b)/i)[0].trim();
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
  match = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s+(20\d{2})\b/i);
  if (match) return validDate(+match[3], months.indexOf(match[1].toLowerCase()) + 1, +match[2]);
  match = text.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(20\d{2})\b/i);
  return match ? validDate(+match[3], months.indexOf(match[2].toLowerCase()) + 1, +match[1]) : null;
}

export function parseReceiptText(text) {
  const normalized = normalizeReceiptText(text);
  return { amount: parseAmount(normalized), referenceNo: parseReference(normalized), paymentDate: parseDate(normalized) };
}

// A disagreement between OCR passes needs human review, not a guessed payment value.
export function reconcileReceiptFields(candidates) {
  return Object.fromEntries(['amount', 'referenceNo', 'paymentDate'].map((key) => {
    const values = [...new Set(candidates.map((candidate) => candidate[key]).filter((value) => value !== null))];
    return [key, values.length === 1 ? values[0] : null];
  }));
}
