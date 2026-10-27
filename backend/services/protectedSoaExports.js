import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { loadProtectedSoaSource, exportError } from './protectedSoaSource.js';
import { renderSoaPdf, loadSoaLogo } from './soaPdf.js';
import { encryptSoaPdf, cleanupSoaTemporaryFiles } from './soaEncryption.js';
import { createProtectedSoaMailer } from './protectedSoaEmail.js';
import { defaultSoaTemplate } from './soaTemplate.js';

export const maskExportEmail = email => {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 1)}***@${domain}`;
};
const unavailable = () => exportError(503, 'PROTECTED_EXPORT_UNAVAILABLE', 'Protected SOA downloads are temporarily unavailable. Please try again later.');

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
      ...(row.status === 'FAILED' ? { message: 'The protected export could not be completed. Create a fresh download to try again.' } : {}),
    };
  }
  async function invalidate(id, status = 'EXPIRED', code = null) {
    await db.query('UPDATE soa_exports SET status=$2,encrypted_pdf=NULL,failure_code=$3,updated_at=NOW() WHERE id=$1', [id, status, code]);
  }
  async function currentSource(row, residentId) {
    const current = await source(db, row.unit_bill_id, residentId);
    if (current.email !== row.recipient_email || current.fingerprint !== row.content_fingerprint) {
      await invalidate(row.id);
      throw exportError(409, 'SOA_CHANGED', 'Your statement or account email changed. Create a fresh protected download.');
    }
    return current;
  }
  async function read(exportId, residentId, file = false) {
    await ensureReady();
    await cleanup();
    const row = (await db.query(`${selectMetadata} WHERE id=$1 AND resident_id=$2`, [exportId, residentId])).rows[0];
    if (!row) throw exportError(404, 'EXPORT_NOT_FOUND', 'Protected export not found.');
    await currentSource(row, residentId);
    if (!file) return publicStatus(row);
    if (row.status !== 'READY') throw exportError(row.status === 'EXPIRED' ? 410 : 409, 'EXPORT_NOT_READY', 'This protected download is not available. Create a fresh download if it expired or failed.');
    // The final SELECT also checks the wall-clock deadline (not a cached status).
    const artifact = (await db.query(`SELECT encrypted_pdf FROM soa_exports WHERE id=$1 AND resident_id=$2
      AND status='READY' AND expires_at>NOW()`, [exportId, residentId])).rows[0];
    if (!artifact?.encrypted_pdf) throw exportError(410, 'EXPORT_EXPIRED', 'This download expired. Create a fresh protected download.');
    return { ...publicStatus(row), bytes: artifact.encrypted_pdf };
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
    let password = randomBytes(18).toString('base64url'), plaintext, encrypted;
    try {
      plaintext = await render(captured.bill, row.export_reference, await logo(captured.logoId));
      encrypted = await encrypt(plaintext, password);
      plaintext.fill(0); plaintext = null;
      await currentSource(row, residentId);
      const pending = await db.query(`UPDATE soa_exports SET encrypted_pdf=$2,status='EMAIL_PENDING',updated_at=NOW()
        WHERE id=$1 AND status='PREPARING' AND created_at>NOW()-INTERVAL '5 minutes' RETURNING id`, [row.id, encrypted]);
      if (!pending.rowCount) throw new Error('EXPORT_INTERRUPTED');
      await mailer.send({ email: captured.email, reference: row.export_reference, password,
        unitNumber: captured.bill.unitNumber, periodStart: captured.bill.periodStart, periodEnd: captured.bill.periodEnd });
      password = null;
      const ready = await db.query(`UPDATE soa_exports SET status='READY',ready_at=NOW(),expires_at=NOW()+INTERVAL '15 minutes',updated_at=NOW()
        WHERE id=$1 AND status='EMAIL_PENDING' AND created_at>NOW()-INTERVAL '5 minutes' RETURNING *`, [row.id]);
      if (!ready.rowCount) throw new Error('EXPORT_INTERRUPTED');
      return publicStatus(ready.rows[0]);
    } catch {
      await invalidate(row.id, 'FAILED', 'EXPORT_NOT_COMPLETED');
      return { ...publicStatus({ ...row, status: 'FAILED' }) };
    } finally { password = null; plaintext?.fill(0); encrypted?.fill(0); }
  }
  return { ensureReady, create, read, cleanup };
}

export function startProtectedSoaMaintenance(service) {
  async function sweep() {
    try { await service.cleanup(); await cleanupSoaTemporaryFiles(); }
    catch { /* Older deployments may not have the migration yet; exports stay disabled. */ }
  }
  sweep();
  const timer = setInterval(sweep, 60000); timer.unref();
  if (process.env.SOA_PROTECTED_EXPORTS_ENABLED === 'true') service.ensureReady().catch(() => console.error('Protected SOA downloads disabled: deployment preflight failed.'));
  return timer;
}
