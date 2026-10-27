import PDFDocument from 'pdfkit';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { soaAssetDeliveryUrl } from './soaAssets.js';

const font = name => new URL('../assets/fonts/NotoSans-' + name + '.ttf', import.meta.url);
const date = (value, long = false) => value ? new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', month: long ? 'long' : 'numeric', day: 'numeric', year: 'numeric' }).format(new Date(String(value).slice(0, 10) + 'T00:00:00Z')) : '—';
function previousMonth(value) {
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, Math.min(d, new Date(Date.UTC(y, m - 1, 0)).getUTCDate()))).toISOString().slice(0, 10);
}

export async function loadSoaLogo(logoId) {
  if (!logoId) return readFile(new URL('../assets/residens-logo.png', import.meta.url));
  const response = await fetch(soaAssetDeliveryUrl(logoId), { signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!response.ok || Number(response.headers.get('content-length')) > 5 * 1024 * 1024) throw new Error('SOA_LOGO_UNAVAILABLE');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 5 * 1024 * 1024) throw new Error('SOA_LOGO_TOO_LARGE');
    chunks.push(chunk);
  }
  return sharp(Buffer.concat(chunks), { limitInputPixels: 20000000 }).resize({ width: 1200, withoutEnlargement: true }).png().toBuffer();
}

export async function renderSoaPdf(bill, reference, logo) {
  // Mirror the web viewer's 1040px layout, scaled to A4 landscape with 8mm margins.
  const margin = 8 * 72 / 25.4;
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin, pdfVersion: '1.7',
    info: { Title: 'Statement of account · ' + reference, Author: bill.soaTemplate.companyName, Subject: reference } });
  doc.registerFont('Body', await readFile(font('Regular')));
  doc.registerFont('Bold', await readFile(font('Bold')));
  doc.registerFont('Serif', await readFile(new URL('../assets/fonts/NotoSerif-Bold.ttf', import.meta.url)));
  const chunks = [], result = new Promise((resolve, reject) => {
    doc.on('data', chunk => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
  });
  const t = bill.soaTemplate, x = margin, w = doc.page.width - margin * 2, scale = w / 1040;
  const px = value => value * scale;
  const color = (v, fallback) => /^#[0-9a-f]{6}$/i.test(v || '') ? v : fallback;
  const accent = color(t.accentColor, '#166534'), secondary = color(t.secondaryColor, '#a9cbe8'), highlight = color(t.highlightColor, '#cceabd');
  const border = '#285b78'; let y = margin;
  doc.lineWidth(px(1));
  function setFont(opts = {}) { doc.font(opts.serif ? 'Serif' : opts.bold ? 'Bold' : 'Body').fontSize(px(opts.size || 12)); }
  function text(value, left, top, width, opts = {}) {
    setFont(opts);
    doc.fillColor(opts.fill || '#000000').text(String(value ?? '—'), left, top, { width, align: opts.align || 'left', lineGap: 0, characterSpacing: px(opts.characterSpacing || 0) });
  }
  function wrap(value, width, opts = {}) {
    setFont(opts);
    const lines = [];
    for (const paragraph of String(value ?? '—').split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/)) {
        if (line && doc.widthOfString(line + ' ' + word) > width) { lines.push(line); line = ''; }
        if (doc.widthOfString(word) <= width) line = line ? line + ' ' + word : word;
        else for (const character of word) {
          if (line && doc.widthOfString(line + character) > width) { lines.push(line); line = ''; }
          line += character;
        }
      }
      lines.push(line);
    }
    return lines;
  }
  function rectangle(left, top, width, h, bg = '#ffffff') { doc.rect(left, top, width, h).fillAndStroke(bg, border); }
  function centeredLines(lines, left, top, width, h, opts = {}) {
    setFont(opts);
    const fontHeight = doc.currentLineHeight(true), pitch = px((opts.size || 12) * (opts.lineHeight || 1.5));
    const start = top + (h - fontHeight - (lines.length - 1) * pitch) / 2;
    lines.forEach((line, i) => text(line, left, start + i * pitch, width, opts));
  }
  const currency = (value, strong = false) => ({ value, currency: true, bold: strong });
  function row(cells, widths, { minHeight = 34, paddingX = 5, paddingY = 6, bg = '#ffffff', ...style } = {}) {
    const prepared = cells.map((value, i) => {
      const c = value && typeof value === 'object' ? value : { value };
      const opts = { ...style, ...c };
      const lines = c.currency ? [''] : wrap(c.value, widths[i] - px(paddingX * 2), opts);
      return { ...opts, lines };
    });
    const pitch = px(Math.max(...prepared.map(c => (c.size || 12) * (c.lineHeight || 1.5))));
    const totalLines = Math.max(...prepared.map(c => c.lines.length));
    const h = Math.max(px(minHeight), totalLines * pitch + px(paddingY * 2));
    function nextPage() {
      doc.addPage(); y = margin;
      text('Statement of account · Unit ' + (bill.unitNumber || '—') + ' · ' + reference + ' · Continued', x, y, w, { size: 10, bold: true });
      y += px(26);
    }
    const bottom = () => doc.page.height - margin - px(20);
    if (h <= doc.page.height - margin * 2 - px(46) && y + h > bottom()) nextPage();
    let offset = 0;
    while (offset < totalLines) {
      if (bottom() - y < Math.max(px(minHeight), pitch + px(paddingY * 2))) nextPage();
      const count = Math.min(totalLines - offset, Math.max(1, Math.floor((bottom() - y - px(paddingY * 2)) / pitch)));
      const partH = Math.max(px(minHeight), count * pitch + px(paddingY * 2));
      let left = x;
      prepared.forEach((c, i) => {
        rectangle(left, y, widths[i], partH, c.bg || bg);
        const pad = px(paddingX), available = widths[i] - pad * 2;
        if (c.currency && offset === 0) {
          let size = c.size || 12;
          const number = Number(c.value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          setFont({ ...c, size });
          while (size > 7 && doc.widthOfString(number) + doc.widthOfString('₱') + px(6) > available) { size -= .25; setFont({ ...c, size }); }
          centeredLines(['₱'], left + pad, y, available, partH, { ...c, size, align: 'left' });
          centeredLines([number], left + pad + px(12), y, available - px(12), partH, { ...c, size, align: 'right' });
        } else if (!c.currency) centeredLines(c.lines.slice(offset, offset + count), left + pad, y, available, partH, c);
        left += widths[i];
      });
      offset += count; y += partH;
    }
  }
  const brandW = w / 2.06, accountW = w - brandW;
  const unit = bill.floor ? 'SMRD-' + String(bill.floor).replace(/^(?:smrd|floor)[-\s]*/i, '') + '-' + bill.unitNumber : bill.unitNumber || '—';
  const account = [
    { value: t.statementTitle, size: 15 }, { value: bill.payerName || 'NO ASSIGNED PAYER', size: 13 },
    { value: unit, size: 13 }, { value: 'Statement Date: ' + date(bill.statementDate, true), size: 12 },
    { value: 'Due Date: ' + date(bill.dueDate, true), size: 12, fill: '#b91c1c' },
  ].map(c => ({ ...c, serif: true, align: 'center', lines: wrap(c.value, accountW - px(16), { ...c, serif: true }) }));
  const accountHeights = account.map(c => px(c.lines.length * c.size * 1.5 + 6));
  const headerH = Math.max(px(120), accountHeights.reduce((a, b) => a + b, 0));
  rectangle(x, y, brandW, headerH);
  doc.image(logo, x + px(16), y + px(10), { fit: [brandW - px(32), px(82)], align: 'center', valign: 'center' });
  text(t.companyAddress, x + px(16), y + px(94), brandW - px(32), { size: 10, bold: true, align: 'center', fill: '#315239' });
  rectangle(x + brandW, y, accountW, headerH, highlight);
  let accountY = y;
  account.forEach((c, i) => {
    const h = accountHeights[i];
    centeredLines(c.lines, x + brandW + px(8), accountY, accountW - px(16), h, c);
    accountY += h;
    if (i < account.length - 1) doc.save().strokeOpacity(.22).moveTo(x + brandW, accountY).lineTo(x + w, accountY).stroke(border).restore();
  });
  y += headerH;
  const paymentY = y, paymentWidths = [w * .4 / 2.6, w * .4 * 1.6 / 2.6];
  const instruction = wrap(t.paymentInstruction, w * .6 - px(32), { size: 13, bold: true });
  const paymentMin = Math.max(28, (instruction.length * 13 * 1.35 + 20) / 3);
  for (const [label, value] of [['PAYMENT CHANNEL', t.paymentChannel], ['ACCOUNT NAME', t.paymentAccountName], ['ACCOUNT NUMBER', t.paymentAccountNumber]]) {
    row([{ value: label, size: 10, bold: true }, { value: value || '—', size: 13, bold: true, align: 'center' }], paymentWidths, { minHeight: paymentMin, paddingX: 8, paddingY: 5, bg: secondary });
  }
  rectangle(x + w * .4, paymentY, w * .6, y - paymentY, secondary);
  centeredLines(instruction, x + w * .4 + px(16), paymentY, w * .6 - px(32), y - paymentY, { size: 13, bold: true, align: 'center', lineHeight: 1.35 });
  // The web colgroup weights sum to 102 and browsers normalize them.
  const weights = [16, 16, 10, 9, 9, 11, 8, 11, 12], widths = weights.map(n => w * n / 102);
  row(['BILLING DATE', 'DESCRIPTION', 'PREVIOUS BALANCE', 'PAYMENT', 'INVOICE', 'CURRENT', 'PENALTY', 'BILLED AMOUNT', 'TOTAL BALANCE'], widths, { minHeight: 28, size: 10, bold: true, fill: '#ffffff', align: 'center', bg: accent });
  for (const type of ['ASSOCIATION_DUES', 'WATER']) {
    const charge = bill.charges.find(c => c.chargeType === type), p = bill.chargePayments?.[type] || {};
    const start = type === 'WATER' ? previousMonth(bill.periodStart) : bill.periodStart;
    const end = type === 'WATER' ? previousMonth(bill.periodEnd) : bill.periodEnd;
    row([date(start) + ' - ' + date(end),
      { value: type === 'WATER' ? 'Water Rate @ ' + Number(charge?.rateApplied || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 }) : charge?.description || 'Association Dues', bold: true },
      { value: '—', align: 'center' }, currency(p.approvedAmount), { value: (p.invoiceReferences || []).join(', ') || '—', align: 'center', bold: type === 'WATER' },
      currency(charge?.amount), currency(type === 'WATER' ? 0 : p.penaltyAmount), currency(p.billedAmount), currency(p.remainingBalance)], widths);
  }
  row(['', { value: 'TOTAL AMOUNT', align: 'center', bold: true, bg: highlight }, currency(bill.totalAmount, true), currency(bill.remainingBalance, true)], [w * 60 / 102, w * 19 / 102, widths[7], widths[8]]);
  row(['CATEGORY ADVANCE CREDITS (UNIT-BASED)'], [w], { minHeight: 26, paddingY: 4, size: 10, bold: true, align: 'center' });
  row([{ value: 'WATER ADVANCE', bold: true }, currency(bill.chargePayments?.WATER?.advanceBalance), { value: 'ASSOCIATION ADVANCE', bold: true }, currency(bill.chargePayments?.ASSOCIATION_DUES?.advanceBalance), ''], [w * 2 / 9, w / 9, w / 3, w / 9, w * 2 / 9], { minHeight: 26, paddingY: 4 });
  for (const [label, value, strong] of [['APPROVED PAYMENTS', bill.approvedAmount, false], ['REMAINING BALANCE', bill.remainingBalance, true]]) {
    row([{ value: label, bold: true }, currency(value, strong), ''], [w * 2 / 9, w / 9, w * 2 / 3], { minHeight: 26, paddingY: 4 });
  }
  row(['PREPARED BY: ' + t.preparedByName, 'CHECKED BY: ' + t.checkedByName], [w / 2, w / 2], { minHeight: 32, paddingY: 8, size: 13, bold: true, align: 'center', lineHeight: 1.45, bg: secondary });
  row([t.preparedByTitle, t.checkedByTitle], [w / 2, w / 2], { minHeight: 32, paddingY: 8, size: 13, bold: true, align: 'center', lineHeight: 1.45, bg: secondary });
  for (const line of [t.noticeLine1, t.noticeLine2]) if (line) row([line], [w], { minHeight: 32, paddingY: 8, size: 13, bold: true, align: 'center', lineHeight: 1.45, bg: secondary });
  row([t.footerText], [w], { minHeight: 32, paddingY: 8, size: 12, bold: true, align: 'center', lineHeight: 1.45, characterSpacing: 4.2, bg: highlight });
  text('Protected export ' + reference, x, doc.page.height - margin - px(10), w, { size: 7, align: 'right', fill: '#475569' });
  doc.end();
  return result;
}
