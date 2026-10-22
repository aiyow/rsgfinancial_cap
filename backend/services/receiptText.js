// Preserve the transcription. Field-specific cleanup must not rewrite names or masks.
export function normalizeReceiptText(text = '') {
  return text.replace(/\r\n?/g, '\n').split('\n')
    .map((line) => line.replace(/[\t \u00a0]+/g, ' ').trim())
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function parseAmount(text) {
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
  // A separate Amount row supplies corroboration, without mistaking the words
  // "Total Amount" for a second observation of the same printed number.
  const separateAmount = labeledAmount('amount', String.raw`(?:^|\n)[ \t]*`);
  for (const label of [String.raw`total\s+amount\s+sent`, String.raw`total\s+amount(?:\s+paid)?`, String.raw`amount\s+(?:sent|paid)`, 'amount', 'total']) {
    const match = labeledAmount(label);
    if (!match) continue;
    if (!Number.isFinite(match.amount) || match.amount <= 0) return null;
    // A peso glyph is sometimes read as a leading 7: e.g. ₱1,220.00 becomes
    // 71,220.00. If a distinct Amount row contradicts that bare total and
    // exactly matches the remaining digits, this pass is ambiguous. Withhold
    // it; another pass must actually read the correct amount. Never strip a
    // leading digit from a legitimate total or resolve genuine disagreements.
    if (label.startsWith('total') && !match.currency && separateAmount
      && match.amount !== separateAmount.amount && match.token.startsWith('7')
      && Number(match.token.slice(1).replace(/[, \t]/g, '')) === separateAmount.amount) {
      return null;
    }
    return match.amount;
  }
  const match = text.match(new RegExp(String.raw`(?:PHP|₱)\s*${value}`, 'i'));
  const amount = match ? Number(match[1].replace(/[, \t]/g, '')) : null;
  return Number.isFinite(amount) && amount > 0 ? amount : null;
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
  match = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:\s*,\s*|\s+)(20\d{2})\b/i);
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
