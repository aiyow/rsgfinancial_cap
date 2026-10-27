import crypto, { randomInt, randomBytes, createHash, createHmac, randomUUID } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import PDFDocument from 'pdfkit';
import { readFile, mkdtemp, mkdir, writeFile, rm, readdir, lstat } from 'node:fs/promises';
import sharp from 'sharp';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { billSelect, groupBy } from './billing.js';
import { applyDueLatePenalties } from './payments.js';
import { createProtectedSoaMailer } from './email.js';

// Soa service. Fold the region sections to navigate related code.
// 1. Statement template settings
// 2. Statement logo and QR assets
// 3. Statement opening passwords
// 4. Statement PDF rendering
// 5. PDF encryption and temporary files
// 6. Authorized statement snapshots
// 7. Protected statement email requests and cooldowns

// #region Statement template settings

export const defaultSoaTemplate = {
  companyName: "THE RESIDENS CONDOMINIUM CORPORATION",
  companyAddress: "360 Ramon Magsaysay Blvd., Zone 064 Brgy 632, Sta Mesa, Manila 1016",
  statementTitle: "STATEMENT OF ACCOUNT",
  paymentChannel: "GCASH",
  paymentAccountName: "MADELYN JAMBALOS",
  paymentAccountNumber: "0908 674 2196",
  paymentInstruction: "PAYMENT DETAILS: GCASH • 0908 674 2196 • MADELYN JAMBALOS",
  preparedByName: "JERRY BOY CRISPE",
  preparedByTitle: "BILLING ASSOCIATE",
  checkedByName: "MARIQUT B. RIVERA",
  checkedByTitle: "BUILDING ADMIN",
  noticeLine1: "This temporary arrangement will remain in place until the defunct Board of Trustees formally turn over",
  noticeLine2: "our Official Bank Passbook and Cheque book to the Elected Board of Trustees.",
  footerText: "T H A N K   Y O U!",
  logoPlacement: "LEFT",
  accentColor: "#166534",
  secondaryColor: "#a9cbe8",
  highlightColor: "#cceabd",
};

export async function ensureSoaTemplateSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS soa_templates (
      id SMALLINT PRIMARY KEY DEFAULT 1,
      template_data JSONB NOT NULL,
      updated_by BIGINT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT soa_templates_singleton_check CHECK (id = 1)
    )
  `);
  await client.query("ALTER TABLE unit_bills ADD COLUMN IF NOT EXISTS soa_template_snapshot JSONB NULL");
  await client.query(`ALTER TABLE soa_templates
    ADD COLUMN IF NOT EXISTS logo_asset_public_id VARCHAR(500) NULL,
    ADD COLUMN IF NOT EXISTS logo_asset_mime_type VARCHAR(100) NULL,
    ADD COLUMN IF NOT EXISTS qr_asset_public_id VARCHAR(500) NULL,
    ADD COLUMN IF NOT EXISTS qr_asset_mime_type VARCHAR(100) NULL`);
}

export async function ensureSoaTemplate(client) {
  await ensureSoaTemplateSchema(client);
  const result = await client.query(
    `INSERT INTO soa_templates (id, template_data)
     VALUES (1, $1::jsonb)
     ON CONFLICT (id) DO NOTHING
     RETURNING template_data AS "templateData"`,
    [JSON.stringify(defaultSoaTemplate)],
  );
  if (result.rows[0]) return result.rows[0].templateData;
  const existing = await client.query("SELECT template_data AS \"templateData\" FROM soa_templates WHERE id = 1");
  return existing.rows[0]?.templateData || defaultSoaTemplate;
}

export function normalizeSoaTemplate(value = {}) {
  return { ...defaultSoaTemplate, ...(value || {}) };
}

// #endregion

// #region Statement logo and QR assets

function configurationError() {
  const error = new Error('Cloudinary SOA asset storage is not configured.');
  error.code = 'CLOUDINARY_NOT_CONFIGURED';
  return error;
}

export function createSoaAssetService({ client = cloudinary, environment = process.env, createId = crypto.randomUUID } = {}) {
  function settings() {
    const cloudName = environment.CLOUDINARY_CLOUD_NAME?.trim();
    const apiKey = environment.CLOUDINARY_API_KEY?.trim();
    const apiSecret = environment.CLOUDINARY_API_SECRET?.trim();
    const folder = (environment.CLOUDINARY_SOA_ASSETS_FOLDER || 'rsg-condo/soa-assets').trim().replace(/^\/+|\/+$/g, '');
    if (!cloudName || !apiKey || !apiSecret || !folder) throw configurationError();
    client.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
    return { folder };
  }

  function uploadAsset(buffer, assetType) {
    const { folder } = settings();
    return new Promise((resolve, reject) => {
      const stream = client.uploader.upload_stream({
        resource_type: 'image', type: 'authenticated', folder,
        public_id: `${assetType}-${createId()}`, unique_filename: false, overwrite: false,
      }, (error, result) => {
        if (error) return reject(error);
        if (!result?.public_id) return reject(new Error('Cloudinary did not return an SOA asset ID.'));
        return resolve({ publicId: result.public_id });
      });
      stream.end(buffer);
    });
  }

  async function destroyAsset(publicId) {
    settings();
    if (!publicId) return { result: 'not found' };
    return client.uploader.destroy(publicId, { resource_type: 'image', type: 'authenticated', invalidate: true });
  }

  function deliveryUrl(publicId) {
    settings();
    if (!publicId) throw new Error('SOA asset ID is missing.');
    return client.url(publicId, { resource_type: 'image', type: 'authenticated', sign_url: true, secure: true });
  }

  return { uploadAsset, destroyAsset, deliveryUrl };
}

const assetService = createSoaAssetService();
export const uploadSoaAsset = (...args) => assetService.uploadAsset(...args);
export const destroySoaAsset = (...args) => assetService.destroyAsset(...args);
export const soaAssetDeliveryUrl = (...args) => assetService.deliveryUrl(...args);

// #endregion

// #region Statement opening passwords

// Accounts currently store a complete name. Preserve common compound surnames
// and exclude generational suffixes when deriving the document password.
export function soaPasswordLastName(fullName) {
  const parts = String(fullName || '').normalize('NFC').trim().split(/\s+/).filter(Boolean);
  while (parts.length > 1 && /^(?:jr\.?|sr\.?|ii|iii|iv|v)$/i.test(parts.at(-1))) parts.pop();
  let start = parts.length - 1;
  while (start > 1 && /^(?:de|del|dela|la|las|los|da|das|do|dos|di|van|von|san|santa|santo)$/i.test(parts[start - 1])) start--;
  const lastName = parts.slice(start).join('').toLowerCase();
  if (!lastName || /[\r\n\x00]/.test(lastName)) throw new Error('SOA_RESIDENT_NAME_REQUIRED');
  return lastName;
}

export function createSoaPassword(fullName) {
  return soaPasswordLastName(fullName) + String(randomInt(0, 10000)).padStart(4, '0');
}

// #endregion

// #region Statement PDF rendering

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

// #endregion

// #region PDF encryption and temporary files

const tempRoot = join(tmpdir(), 'residens-protected-soa');
const activeDirectories = new Set();

// qpdf receives only @- in argv. Its complete argument list, including secrets,
// is written to its private stdin pipe. Stderr is deliberately never exposed.
export function runQpdf(argumentsList, { binary = process.env.QPDF_PATH || 'qpdf', maxBytes = 12 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['@-'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    const chunks = []; let size = 0;
    const timeout = setTimeout(() => child.kill(), 30000);
    child.stdout.on('data', chunk => { size += chunk.length; if (size > maxBytes) child.kill(); else chunks.push(chunk); });
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.once('error', () => { clearTimeout(timeout); reject(new Error('PDF_ENCRYPTION_UNAVAILABLE')); });
    child.once('close', code => {
      clearTimeout(timeout);
      if (code !== 0 || size > maxBytes) reject(new Error('PDF_ENCRYPTION_FAILED'));
      else resolve(Buffer.concat(chunks));
    });
    const input = Buffer.from(argumentsList.join('\n') + '\n');
    child.stdin.end(input, () => input.fill(0));
  });
}

export async function cleanupSoaTemporaryFiles() {
  await mkdir(tempRoot, { recursive: true, mode: 0o700 });
  if ((await lstat(tempRoot)).isSymbolicLink()) throw new Error('UNSAFE_PDF_TEMP_DIRECTORY');
  for (const name of await readdir(tempRoot)) {
    if (!/^job-[A-Za-z0-9]+$/.test(name)) continue;
    const path = join(tempRoot, name), stat = await lstat(path);
    if (!stat.isSymbolicLink() && stat.isDirectory() && !activeDirectories.has(path) && stat.mtimeMs < Date.now() - 300000) {
      await rm(path, { recursive: true, force: true });
    }
  }
}

export async function encryptSoaPdf(plaintext, password, { binary } = {}) {
  await mkdir(tempRoot, { recursive: true, mode: 0o700 });
  if ((await lstat(tempRoot)).isSymbolicLink()) throw new Error('UNSAFE_PDF_TEMP_DIRECTORY');
  const directory = await mkdtemp(join(tempRoot, 'job-'));
  activeDirectories.add(directory);
  const input = join(directory, 'statement.pdf'), encryptedPath = join(directory, 'protected.pdf');
  let owner = randomBytes(48).toString('base64url');
  try {
    await writeFile(input, plaintext, { mode: 0o600, flag: 'wx' });
    const encrypted = await runQpdf([input, '--encrypt', password, owner, '256', '--print=full', '--', '-'], { binary });
    await writeFile(encryptedPath, encrypted, { mode: 0o600, flag: 'wx' });
    const inspection = (await runQpdf([`--password=${password}`, '--show-encryption', encryptedPath], { binary })).toString();
    if (!/R = 6\b/.test(inspection) || !/stream encryption method: AESv3/.test(inspection) || !/string encryption method: AESv3/.test(inspection)) throw new Error('PDF_ENCRYPTION_INVALID');
    // Even with a correct encryption dictionary an empty opening password is unsafe.
    let opensWithoutPassword = false;
    try { await runQpdf(['--password=', '--check', encryptedPath], { binary }); opensWithoutPassword = true; } catch { /* expected */ }
    if (opensWithoutPassword) throw new Error('PDF_OPENING_PASSWORD_REQUIRED');
    return encrypted;
  } finally {
    owner = null;
    activeDirectories.delete(directory);
    await rm(directory, { recursive: true, force: true });
  }
}

// #endregion

// #region Authorized statement snapshots

export function exportError(status, code, message, extra = {}) {
  return Object.assign(new Error(message), { status, code, ...extra });
}

function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

export function soaFingerprint(bill, logoId) {
  // Only stable document inputs, including ledger values and the current logo.
  const fields = ['id', 'unitId', 'unitNumber', 'floor', 'periodStart', 'periodEnd', 'statementDate', 'dueDate',
    'payerName', 'soaRevision', 'publishedAt', 'soaTemplate', 'charges', 'totalAmount', 'approvedAmount',
    'remainingBalance', 'latePenaltyAmount', 'chargePayments'];
  const data = Object.fromEntries(fields.map(key => [key, bill[key]]));
  data.logoId = logoId || null;
  // Invalidate already prepared PDFs when the official document layout changes.
  data.pdfLayoutVersion = 2;
  return createHash('sha256').update(JSON.stringify(canonical(data))).digest('hex');
}

export async function loadProtectedSoaSource(db, billId, residentId) {
  // Do not trigger lazy financial recalculation for an inaccessible statement.
  const eligible = (await db.query(`SELECT u.email_verified FROM users u
    WHERE u.id=$2 AND u.role='RESIDENT' AND u.is_active=TRUE AND u.approval_status='APPROVED'
    AND EXISTS(SELECT 1 FROM unit_bills b JOIN billing_periods p ON p.id=b.billing_period_id
      JOIN unit_assignments a ON a.unit_id=b.unit_id AND a.user_id=u.id
      WHERE b.id=$1 AND b.published_at IS NOT NULL AND p.status IN ('FORWARDED','CLOSED')
      AND a.end_date IS NULL AND a.start_date <= (NOW() AT TIME ZONE 'Asia/Manila')::date)`, [billId, residentId])).rows[0];
  if (!eligible) throw exportError(404, 'SOA_UNAVAILABLE', 'This statement is no longer available to your account.');
  if (!eligible.email_verified) throw exportError(403, 'EMAIL_VERIFICATION_REQUIRED', 'Verify your account email before requesting an SOA.');
  await applyDueLatePenalties(db, billId);
  const client = await db.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const user = (await client.query(`SELECT full_name, email, email_verified FROM users WHERE id=$1 AND role='RESIDENT'
      AND is_active=TRUE AND approval_status='APPROVED'`, [residentId])).rows[0];
    if (!user) throw exportError(403, 'EXPORT_ACCESS_DENIED', 'This account cannot request resident statements.');
    if (!user.email_verified) throw exportError(403, 'EMAIL_VERIFICATION_REQUIRED', 'Verify your account email before requesting an SOA.');
    const bill = (await client.query(`${billSelect} WHERE b.id=$1 AND b.published_at IS NOT NULL
      AND p.status IN ('FORWARDED','CLOSED') AND EXISTS (SELECT 1 FROM unit_assignments a
      WHERE a.unit_id=b.unit_id AND a.user_id=$2 AND a.end_date IS NULL
      AND a.start_date <= (NOW() AT TIME ZONE 'Asia/Manila')::date) ${groupBy}`, [billId, residentId])).rows[0];
    if (!bill) throw exportError(404, 'SOA_UNAVAILABLE', 'This statement is no longer available to your account.');
    bill.charges = (await client.query(`SELECT id,charge_type AS "chargeType",quantity,rate_applied AS "rateApplied",
      ROUND(quantity*rate_applied,2) AS amount,description FROM bill_charges WHERE unit_bill_id=$1 ORDER BY id`, [billId])).rows;
    bill.soaTemplate = normalizeSoaTemplate(bill.soaTemplate);
    for (const category of Object.values(bill.chargePayments || {})) {
      category.invoiceReferences?.sort();
      category.payments?.sort((a, b) => JSON.stringify(canonical(a)).localeCompare(JSON.stringify(canonical(b))));
    }
    const logoId = (await client.query('SELECT logo_asset_public_id FROM soa_templates WHERE id=1')).rows[0]?.logo_asset_public_id || null;
    await client.query('COMMIT');
    return { bill, residentName: user.full_name, email: user.email, logoId, fingerprint: soaFingerprint(bill, logoId) };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

// #endregion

// #region Protected statement email requests and cooldowns

export const maskExportEmail = email => {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 1)}***@${domain}`;
};
const unavailable = () => exportError(503, 'PROTECTED_EXPORT_UNAVAILABLE', 'SOA email requests are temporarily unavailable. Please try again later.');
const EMAIL_COOLDOWN_MS = 30 * 60 * 1000;

export function createProtectedSoaExportService({ db, environment = process.env, mailer = createProtectedSoaMailer({ environment }),
  source = loadProtectedSoaSource, render = renderSoaPdf, encrypt = encryptSoaPdf, logo = loadSoaLogo,
  checkDependencies, } = {}) {
  let readiness;
  async function ensureReady() {
    if (environment.SOA_PROTECTED_EXPORTS_ENABLED !== 'true') throw unavailable();
    if (!readiness) readiness = (async () => {
      await db.query('SELECT encrypted_pdf, content_fingerprint FROM soa_exports LIMIT 0');
      await db.query('SELECT ip_hash FROM soa_export_rate_events LIMIT 0');
      if (checkDependencies) return checkDependencies();
      await cleanupSoaTemporaryFiles();
      const password = randomBytes(18).toString('base64url');
      const pdf = await renderSoaPdf({ soaTemplate: defaultSoaTemplate, charges: [], periodStart: '2026-01-01', periodEnd: '2026-02-01' }, 'SELF-CHECK', await loadSoaLogo(null));
      try { await encryptSoaPdf(pdf, password); } finally { pdf.fill(0); }
      await mailer.verify(); // TLS negotiation and authentication must succeed.
    })().catch(() => { readiness = null; throw unavailable(); });
    await readiness;
  }

  async function cleanup() {
    // Old portal artifacts must also stop being retained after switching to email.
    await db.query("UPDATE soa_exports SET encrypted_pdf=NULL,status='EXPIRED',updated_at=NOW() WHERE status='READY' AND expires_at IS NOT NULL");
    await db.query(`UPDATE soa_exports SET status=CASE WHEN status IN ('PREPARING','EMAIL_PENDING') THEN 'FAILED' ELSE 'EXPIRED' END,
      encrypted_pdf=NULL, failure_code=CASE WHEN status IN ('PREPARING','EMAIL_PENDING') THEN 'PREPARATION_INTERRUPTED' ELSE NULL END,
      updated_at=NOW() WHERE (status IN ('PREPARING','EMAIL_PENDING') AND created_at < NOW()-INTERVAL '5 minutes')
      OR (status='READY' AND expires_at <= NOW())`);
    await db.query("DELETE FROM soa_exports WHERE created_at < NOW()-INTERVAL '30 days'");
    await db.query("DELETE FROM soa_export_rate_events WHERE created_at < NOW()-INTERVAL '1 hour'");
  }

  const selectMetadata = `SELECT id,export_reference, resident_id,unit_bill_id,soa_revision,content_fingerprint,
    recipient_email,idempotency_key,status,failure_code,created_at,ready_at,expires_at FROM soa_exports`;
  function publicStatus(row) {
    return { exportId: row.id, reference: row.export_reference, status: row.status,
      maskedEmail: maskExportEmail(row.recipient_email), expiresAt: row.expires_at,
      filename: `SOA-${row.export_reference}.pdf`,
      ...(row.ready_at ? { nextRequestAt: new Date(new Date(row.ready_at).getTime() + EMAIL_COOLDOWN_MS).toISOString() } : {}),
      ...(row.status === 'FAILED' ? { message: 'Your SOA email could not be sent. Please submit a new request.' } : {}),
    };
  }

  async function recentRequest(database, billId, residentId, email) {
    return (await database.query(`${selectMetadata} WHERE resident_id=$1 AND unit_bill_id=$2 AND recipient_email=$3
      AND expires_at IS NULL AND (ready_at > NOW()-INTERVAL '30 minutes'
        OR (status IN ('PREPARING','EMAIL_PENDING') AND created_at > NOW()-INTERVAL '5 minutes'))
      ORDER BY ready_at DESC NULLS LAST,created_at DESC LIMIT 1`, [residentId, billId, email])).rows[0];
  }

  async function status(billId, residentId) {
    const captured = await source(db, billId, residentId);
    const recent = await recentRequest(db, billId, residentId, captured.email);
    return recent ? publicStatus({ ...recent, ...(recent.ready_at ? { status: 'READY' } : {}) }) : { status: 'AVAILABLE' };
  }
  async function invalidate(id, status = 'EXPIRED', code = null) {
    await db.query('UPDATE soa_exports SET status=$2,encrypted_pdf=NULL,failure_code=$3,updated_at=NOW() WHERE id=$1', [id, status, code]);
  }
  async function currentSource(row, residentId) {
    const current = await source(db, row.unit_bill_id, residentId);
    if (current.email !== row.recipient_email || current.fingerprint !== row.content_fingerprint) {
      await invalidate(row.id);
      throw exportError(409, 'SOA_CHANGED', 'Your statement or account email changed. Please request your SOA again.');
    }
    return current;
  }
  async function read(exportId, residentId, file = false) {
    await ensureReady();
    await cleanup();
    const row = (await db.query(`${selectMetadata} WHERE id=$1 AND resident_id=$2`, [exportId, residentId])).rows[0];
    if (!row) throw exportError(404, 'EXPORT_NOT_FOUND', 'Protected export not found.');
    await currentSource(row, residentId);
    if (file) throw exportError(410, 'SOA_EMAIL_ONLY', 'Your protected SOA is available as an email attachment. Please check your email or request a new copy.');
    return publicStatus(row);
  }

  async function reserve(billId, residentId, key, ip, captured) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`soa-export:user:${residentId}`]);
      const existing = (await client.query(`${selectMetadata} WHERE resident_id=$1 AND idempotency_key=$2`, [residentId, key])).rows[0];
      if (existing) {
        if (String(existing.unit_bill_id) !== String(billId)) throw exportError(409, 'IDEMPOTENCY_CONFLICT', 'Use a new request for this statement.');
        await client.query('COMMIT'); return { row: existing, fresh: false };
      }
      const recent = await recentRequest(client, billId, residentId, captured.email);
      if (recent?.ready_at) {
        const nextRequestAt = new Date(new Date(recent.ready_at).getTime() + EMAIL_COOLDOWN_MS).toISOString();
        throw exportError(429, 'SOA_EMAIL_COOLDOWN', 'SOA already sent in email. Please wait 30 minutes before requesting again.', {
          nextRequestAt, retryAfterSeconds: Math.max(1, Math.ceil((Date.parse(nextRequestAt) - Date.now()) / 1000)),
        });
      }
      if (recent) { await client.query('COMMIT'); return { row: recent, fresh: false }; }
      const ipHash = createHmac('sha256', environment.SOA_EXPORT_RATE_SECRET || environment.JWT_SECRET).update(String(ip)).digest('hex');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`soa-export:ip:${ipHash}`]);
      const limits = (await client.query(`SELECT COUNT(*) FILTER(WHERE resident_id=$1)::int AS resident,
        COUNT(*) FILTER(WHERE ip_hash=$2)::int AS ip,
        EXTRACT(EPOCH FROM NOW()-MAX(created_at) FILTER(WHERE resident_id=$1)) AS seconds_since_latest
        FROM soa_export_rate_events WHERE created_at > NOW()-INTERVAL '1 hour' AND (resident_id=$1 OR ip_hash=$2)`, [residentId, ipHash])).rows[0];
      const sinceLast = limits.seconds_since_latest === null ? Infinity : Number(limits.seconds_since_latest);
      if (limits.resident >= 5 || limits.ip >= 20 || sinceLast < 60) {
        throw exportError(429, 'EXPORT_RATE_LIMIT', 'Please wait before creating another protected SOA.', { retryAfterSeconds: sinceLast < 60 ? Math.max(1, Math.ceil(60 - sinceLast)) : 3600 });
      }
      const id = randomUUID(), ref = `SX-${randomBytes(8).toString('hex').toUpperCase()}`;
      await client.query(`INSERT INTO soa_exports(id,export_reference,resident_id,unit_bill_id,soa_revision,
        content_fingerprint,recipient_email,idempotency_key,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PREPARING')`,
      [id, ref, residentId, billId, captured.bill.soaRevision || 1, captured.fingerprint, captured.email, key]);
      await client.query('INSERT INTO soa_export_rate_events(export_id,resident_id,ip_hash) VALUES($1,$2,$3)', [id, residentId, ipHash]);
      const row = (await client.query(`${selectMetadata} WHERE id=$1`, [id])).rows[0];
      await client.query('COMMIT'); return { row, fresh: true };
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }

  async function create(billId, residentId, key, ip) {
    await ensureReady();
    await cleanup();
    const captured = await source(db, billId, residentId);
    const { row, fresh } = await reserve(billId, residentId, key, ip, captured);
    if (!fresh) { await currentSource(row, residentId); return publicStatus(row); }
    let password, plaintext, encrypted;
    try {
      password = createSoaPassword(captured.residentName);
      plaintext = await render(captured.bill, row.export_reference, await logo(captured.logoId));
      encrypted = await encrypt(plaintext, password);
      plaintext.fill(0); plaintext = null;
      const current = await currentSource(row, residentId);
      if (current.residentName !== captured.residentName) throw new Error('SOA_RESIDENT_CHANGED');
      const pending = await db.query(`UPDATE soa_exports SET encrypted_pdf=NULL,status='EMAIL_PENDING',updated_at=NOW()
        WHERE id=$1 AND status='PREPARING' AND created_at>NOW()-INTERVAL '5 minutes' RETURNING id`, [row.id]);
      if (!pending.rowCount) throw new Error('EXPORT_INTERRUPTED');
      await mailer.send({ email: captured.email, reference: row.export_reference, password,
        residentName: captured.residentName, pdf: encrypted,
        unitNumber: captured.bill.unitNumber, periodStart: captured.bill.periodStart, periodEnd: captured.bill.periodEnd,
        dueDate: captured.bill.dueDate, companyName: captured.bill.soaTemplate.companyName });
      password = null;
      const ready = await db.query(`UPDATE soa_exports SET status='READY',encrypted_pdf=NULL,ready_at=NOW(),expires_at=NULL,updated_at=NOW()
        WHERE id=$1 AND status='EMAIL_PENDING' AND created_at>NOW()-INTERVAL '5 minutes' RETURNING *`, [row.id]);
      if (!ready.rowCount) throw new Error('EXPORT_INTERRUPTED');
      return publicStatus(ready.rows[0]);
    } catch {
      await invalidate(row.id, 'FAILED', 'EXPORT_NOT_COMPLETED');
      return { ...publicStatus({ ...row, status: 'FAILED' }) };
    } finally { password = null; plaintext?.fill(0); encrypted?.fill(0); }
  }
  return { ensureReady, create, read, status, cleanup };
}

export function startProtectedSoaMaintenance(service) {
  async function sweep() {
    try { await service.cleanup(); await cleanupSoaTemporaryFiles(); }
    catch { /* Older deployments may not have the migration yet; exports stay disabled. */ }
  }
  sweep();
  const timer = setInterval(sweep, 60000); timer.unref();
  if (process.env.SOA_PROTECTED_EXPORTS_ENABLED === 'true') service.ensureReady().catch(() => console.error('SOA email requests disabled: deployment preflight failed.'));
  return timer;
}

// #endregion
