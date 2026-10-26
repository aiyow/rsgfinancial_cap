import { calculateLatePenalty, applyDueLatePenalties, ensurePaymentLedgerSchema } from './paymentLedger.js';
import { cents, money } from './paymentAllocation.js';

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
