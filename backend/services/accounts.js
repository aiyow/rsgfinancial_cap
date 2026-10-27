import crypto from 'node:crypto';
import pool from '../config/db.js';
import {
  calculateLatePenalty,
  applyDueLatePenalties,
  ensurePaymentLedgerSchema,
  cents,
  money,
} from './payments.js';

// Accounts service. Fold the region sections to navigate related code.
// 1. Email identity normalization
// 2. Email change verification
// 3. Registration challenges and quotas
// 4. Account eligibility and unit safeguards

// #region Email identity normalization

export function normalizeEmailIdentity(email) {
  return String(email ?? "").trim().toLowerCase();
}

// #endregion

// #region Email change verification

export const EMAIL_CHANGE_COOLDOWN_SECONDS = 60;
export const EMAIL_CHANGE_MAX_ATTEMPTS = 5;
export const emailChangeExpiry = (now = new Date()) => new Date(now.getTime() + 10 * 60 * 1000);
export const createEmailChangeCode = () => crypto.randomInt(0, 1000000).toString().padStart(6, '0');

export function hashEmailChangeCode(challengeId, email, code, secret = process.env.JWT_SECRET) {
  if (!secret) throw new Error('JWT_SECRET is not configured.');
  return crypto.createHmac('sha256', secret).update(`email-change:${challengeId}:${email}:${code}`).digest('hex');
}

export function emailChangeCodeMatches(challengeId, email, code, hash) {
  const expected = Buffer.from(hash || '', 'hex');
  const actual = Buffer.from(hashEmailChangeCode(challengeId, email, code), 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// #endregion

// #region Registration challenges and quotas

export const REGISTRATION_TTL_MS = 10 * 60 * 1000;
export const REGISTRATION_MAX_ATTEMPTS = 5;
export const REGISTRATION_COOLDOWN_SECONDS = 60;
export const createRegistrationOtp = () => crypto.randomInt(0, 1000000).toString().padStart(6, '0');
export const createRegistrationToken = () => crypto.randomBytes(32).toString('base64url');
export const registrationExpiry = () => new Date(Date.now() + REGISTRATION_TTL_MS);
export function registrationHash(purpose, ...values) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured.');
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update(JSON.stringify(['registration', purpose, ...values])).digest('hex');
}
export function registrationOtpMatches(challenge, email, otp) {
  const actual = Buffer.from(registrationHash('otp', challenge.id, email, otp), 'hex');
  const expected = Buffer.from(challenge.otp_hash || '', 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
export const lockRegistrationEmail = (client, email) => client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ['registration:'+email]);

export async function consumeRegistrationGrant(client, email, token) {
  await lockRegistrationEmail(client, email);
  const result = await client.query(`SELECT email FROM registration_challenges
    WHERE email=$1 AND verified_token_hash=$2 AND expires_at>NOW() FOR UPDATE`, [email, registrationHash('grant', email, token)]);
  if (!result.rowCount) throw Object.assign(new Error('Verify your email before creating an account. Your verification may have expired.'), { status: 403 });
  // Deleted in the same transaction as account creation; rollback restores the grant.
  await client.query('DELETE FROM registration_challenges WHERE email=$1', [email]);
}

export async function registrationQuota(database, action, identity, limit, seconds) {
  const result = await database.query(`INSERT INTO registration_rate_limits(key_hash,expires_at)
    VALUES($1,NOW()+make_interval(secs=>$2)) ON CONFLICT(key_hash) DO UPDATE SET
    request_count=CASE WHEN registration_rate_limits.expires_at<=NOW() THEN 1 ELSE LEAST(registration_rate_limits.request_count+1,1000000) END,
    window_started_at=CASE WHEN registration_rate_limits.expires_at<=NOW() THEN NOW() ELSE registration_rate_limits.window_started_at END,
    expires_at=CASE WHEN registration_rate_limits.expires_at<=NOW() THEN NOW()+make_interval(secs=>$2) ELSE registration_rate_limits.expires_at END
    RETURNING request_count, GREATEST(1,CEIL(EXTRACT(EPOCH FROM expires_at-NOW())))::int AS retry`, [registrationHash('quota', action, identity), seconds]);
  const row = result.rows[0];
  if (row.request_count > limit) throw Object.assign(new Error('Too many registration requests. Please try again later.'), { status: 429, retryAfterSeconds: row.retry });
  return row.request_count;
}

export async function cleanupRegistrationData(database = pool) {
  await database.query('DELETE FROM registration_challenges WHERE expires_at<=NOW()');
  await database.query('DELETE FROM registration_rate_limits WHERE expires_at<=NOW()');
}
export function startRegistrationCleanup() {
  const run = () => cleanupRegistrationData().catch(error => console.error('Registration cleanup failed:', error.message));
  void run();
  const timer = setInterval(run, 15 * 60 * 1000);
  timer.unref();
}

// #endregion

// #region Account eligibility and unit safeguards

export const ASSIGNMENT_BLOCK = 'This account is assigned to a unit. Unassign the resident before deleting.';
export const BALANCE_BLOCK = 'This resident has unpaid published SOA charges. Settle the required charges before deactivating the account.';

export async function lockAccountRows(client, userIds) {
  return client.query('SELECT id FROM users WHERE id = ANY($1::bigint[]) ORDER BY id FOR NO KEY UPDATE', [[...new Set(userIds)]]);
}

export async function openAccountAssignments(client, userId) {
  return (await client.query(`SELECT a.id AS "assignmentId", a.unit_id AS "unitId", u.unit_number AS "unitNumber",
      a.relationship_type AS "relationshipType" FROM unit_assignments a JOIN units u ON u.id=a.unit_id
      WHERE a.user_id=$1 AND a.end_date IS NULL ORDER BY u.id,a.id`, [userId])).rows;
}

async function publishedBalances(client, unitIds) {
  return (await client.query(`SELECT b.id AS "billId", b.unit_id AS "unitId", u.unit_number AS "unitNumber",
      b.period_start_snapshot AS "periodStart", b.period_end_snapshot AS "periodEnd", b.due_date_snapshot AS "dueDate",
      b.late_penalty_percent_snapshot AS "penaltyPercent",
      COALESCE((SELECT SUM(ROUND(c.quantity*c.rate_applied,2)) FROM bill_charges c WHERE c.unit_bill_id=b.id AND c.charge_type='WATER'),0) AS water,
      COALESCE((SELECT SUM(ROUND(c.quantity*c.rate_applied,2)) FROM bill_charges c WHERE c.unit_bill_id=b.id AND c.charge_type='ASSOCIATION_DUES'),0) AS association,
      COALESCE(SUM(x.amount_applied) FILTER(WHERE a.charge_type='WATER' AND p.review_status='APPROVED'),0) AS "paidWater",
      COALESCE(SUM(x.amount_applied) FILTER(WHERE a.charge_type='ASSOCIATION_DUES' AND p.review_status='APPROVED'),0) AS "paidAssociation",
      COALESCE(SUM(x.amount_applied) FILTER(WHERE a.charge_type='ASSOCIATION_DUES' AND x.component='PRINCIPAL'
        AND p.review_status='APPROVED' AND p.verified_payment_date <= b.due_date_snapshot),0) AS "associationPaidOnTime"
    FROM unit_bills b JOIN units u ON u.id=b.unit_id
    LEFT JOIN payment_applications x ON x.unit_bill_id=b.id
    LEFT JOIN payment_charge_allocations a ON a.id=x.charge_allocation_id
    LEFT JOIN payment_submissions p ON p.id=a.payment_submission_id
    WHERE b.unit_id=ANY($1::bigint[]) AND b.published_at IS NOT NULL
    GROUP BY b.id,u.unit_number ORDER BY b.unit_id,b.period_start_snapshot,b.id`, [unitIds])).rows;
}

export async function accountActionEligibility(client, user, actorUserId, { refreshPenalties = false } = {}) {
  const activeAssignments = await openAccountAssignments(client, user.id);
  const ownerUnits = new Set(activeAssignments.filter(a => a.relationshipType === 'OWNER').map(a => String(a.unitId)));
  const unitIds = [...new Set(activeAssignments.map(a => a.unitId))];
  let unpaidSOAs = [];
  if (user.role === 'RESIDENT' && user.isActive && unitIds.length) {
    await ensurePaymentLedgerSchema(client);
    if (refreshPenalties) {
      await client.query('SELECT id FROM units WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE', [unitIds]);
      const bills = await publishedBalances(client, unitIds);
      for (const bill of bills) {
        if (ownerUnits.has(String(bill.unitId))) await applyDueLatePenalties(client, bill.billId);
      }
    }
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    unpaidSOAs = (await publishedBalances(client, unitIds)).flatMap(bill => {
      const owner = ownerUnits.has(String(bill.unitId));
      const penalty = calculateLatePenalty(money(Math.max(cents(bill.association)-cents(bill.associationPaidOnTime),0)), bill.penaltyPercent, bill.dueDate < today);
      const water = Math.max(cents(bill.water)-cents(bill.paidWater),0);
      const association = owner ? Math.max(cents(bill.association)+cents(penalty)-cents(bill.paidAssociation),0) : 0;
      if (!water && !association) return [];
      return [{ billId: bill.billId, unitId: bill.unitId, unitNumber: bill.unitNumber,
        periodStart: bill.periodStart, periodEnd: bill.periodEnd, relationshipType: owner ? 'OWNER' : 'TENANT',
        requiredCategories: owner ? ['WATER','ASSOCIATION_DUES'] : ['WATER'],
        balances: { WATER: money(water), ASSOCIATION_DUES: money(association) }, remainingBalance: money(water+association) }];
    });
  }
  const self = Number(user.id) === Number(actorUserId);
  return { activeAssignments, unpaidSOAs,
    totalOutstanding: money(unpaidSOAs.reduce((sum,bill) => sum+cents(bill.remainingBalance),0)),
    canDelete: !self && !activeAssignments.length,
    deleteBlockReason: self ? 'You cannot delete your own account.' : activeAssignments.length ? ASSIGNMENT_BLOCK : null,
    canDeactivate: !self && !unpaidSOAs.length,
    deactivationBlockReason: self ? 'You cannot deactivate your own account.' : unpaidSOAs.length ? BALANCE_BLOCK : null,
    requiresPasswordForDelete: ['ADMIN','COLLECTOR'].includes(user.role) };
}

// #endregion
