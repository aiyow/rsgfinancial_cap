import { createHash } from 'node:crypto';
import { billSelect, groupBy } from './billRead.js';
import { applyDueLatePenalties } from './paymentLedger.js';
import { normalizeSoaTemplate } from './soaTemplate.js';

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
  if (!eligible.email_verified) throw exportError(403, 'EMAIL_VERIFICATION_REQUIRED', 'Verify your account email before downloading a protected SOA.');
  await applyDueLatePenalties(db, billId);
  const client = await db.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const user = (await client.query(`SELECT email, email_verified FROM users WHERE id=$1 AND role='RESIDENT'
      AND is_active=TRUE AND approval_status='APPROVED'`, [residentId])).rows[0];
    if (!user) throw exportError(403, 'EXPORT_ACCESS_DENIED', 'This account cannot download resident statements.');
    if (!user.email_verified) throw exportError(403, 'EMAIL_VERIFICATION_REQUIRED', 'Verify your account email before downloading a protected SOA.');
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
    return { bill, email: user.email, logoId, fingerprint: soaFingerprint(bill, logoId) };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
