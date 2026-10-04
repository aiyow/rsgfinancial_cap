import { allocateCategoryCredit, allocatePaymentPurpose, cents, money } from './paymentAllocation.js';

const billBaseTotalSql = `COALESCE((SELECT SUM(ROUND(c.quantity * c.rate_applied, 2)) FROM bill_charges c WHERE c.unit_bill_id = b.id), 0)`;
const billLatePenaltySql = `COALESCE(b.late_penalty_amount, 0)`;
const billTotalSql = `((${billBaseTotalSql}) + (${billLatePenaltySql}))`;
const billAppliedSql = `COALESCE((SELECT ROUND(SUM(pa.amount_applied), 2) FROM payment_applications pa WHERE pa.unit_bill_id = b.id), 0)`;
const paymentAppliedSql = `COALESCE((SELECT ROUND(SUM(pa.amount_applied), 2) FROM payment_applications pa WHERE pa.payment_submission_id = ps.id), 0)`;

export const chargePaymentsSql = `(SELECT jsonb_object_agg(category.charge_type, jsonb_build_object(
  'chargeType', category.charge_type, 'currentAmount', COALESCE(charge.amount,0),
  'penaltyAmount', CASE WHEN category.charge_type='ASSOCIATION_DUES' THEN b.late_penalty_amount ELSE 0 END,
  'billedAmount', COALESCE(charge.amount,0) + CASE WHEN category.charge_type='ASSOCIATION_DUES' THEN b.late_penalty_amount ELSE 0 END,
  'approvedAmount', COALESCE(paid.amount,0),
  'principalPaid', COALESCE(paid.principal,0), 'penaltyPaid', COALESCE(paid.penalty,0),
  'remainingBalance', GREATEST(COALESCE(charge.amount,0) + CASE WHEN category.charge_type='ASSOCIATION_DUES' THEN b.late_penalty_amount ELSE 0 END - COALESCE(paid.amount,0),0),
  'invoiceReferences', COALESCE(paid.invoices,'[]'::jsonb), 'payments', COALESCE(paid.payments,'[]'::jsonb),
  'advanceBalance', COALESCE(credit.amount,0),
  'hasPendingPayment', EXISTS(SELECT 1 FROM payment_submissions pending WHERE pending.target_unit_bill_id=b.id AND pending.review_status='PENDING' AND pending.payment_purpose IN (category.charge_type,'COMBINED'))
))
FROM (VALUES ('WATER'),('ASSOCIATION_DUES')) category(charge_type)
LEFT JOIN LATERAL (SELECT ROUND(c.quantity*c.rate_applied,2) AS amount FROM bill_charges c WHERE c.unit_bill_id=b.id AND c.charge_type=category.charge_type) charge ON TRUE
LEFT JOIN LATERAL (
 SELECT SUM(x.amount_applied) AS amount, SUM(x.amount_applied) FILTER(WHERE x.component='PRINCIPAL') AS principal,
 SUM(x.amount_applied) FILTER(WHERE x.component='LATE_PENALTY') AS penalty,
 jsonb_agg(DISTINCT a.invoice_number) FILTER(WHERE a.invoice_number IS NOT NULL) AS invoices,
 jsonb_agg(DISTINCT jsonb_build_object('paymentId',a.payment_submission_id,'chargeType',a.charge_type,'invoiceNumber',a.invoice_number)) AS payments
 FROM payment_applications x JOIN payment_charge_allocations a ON a.id=x.charge_allocation_id
 WHERE x.unit_bill_id=b.id AND a.charge_type=category.charge_type
) paid ON TRUE
LEFT JOIN LATERAL (
 SELECT SUM(a.allocated_amount-COALESCE((SELECT SUM(x.amount_applied) FROM payment_applications x WHERE x.charge_allocation_id=a.id),0)) AS amount
 FROM payment_charge_allocations a JOIN payment_submissions p ON p.id=a.payment_submission_id
 WHERE p.unit_id=b.unit_id AND p.review_status='APPROVED' AND a.charge_type=category.charge_type
) credit ON TRUE)`;

export async function ensurePaymentLedgerSchema(client) {
  const table = await client.query("SELECT to_regclass('payment_ledger_policy') AS policy");
  const ready = table.rows[0]?.policy && (await client.query('SELECT version FROM payment_ledger_policy WHERE id=1')).rows[0]?.version === 2;
  if (!ready) throw Object.assign(new Error('Category payment ledger is not activated. Run payments:preflight and migration 033 after the clean-start prerequisite.'), { status: 503 });
}

export async function lockUnit(client, unitId) {
  const result = await client.query('SELECT id FROM units WHERE id=$1 FOR UPDATE', [unitId]);
  if (!result.rows[0]) throw Object.assign(new Error('Unit not found.'), { status: 404 });
}

export function calculateLatePenalty(baseTotal, percentage, isOverdue) {
  const total = Number(baseTotal || 0);
  const rate = Number(percentage || 0);
  if (!isOverdue || !Number.isFinite(total) || !Number.isFinite(rate) || total <= 0 || rate <= 0) return 0;
  return Number((total * rate / 100).toFixed(2));
}

async function trimBillApplications(client, billId) {
  const bill = await client.query(`SELECT b.id, ${chargePaymentsSql} AS "chargePayments" FROM unit_bills b WHERE b.id=$1`, [billId]);
  if (!bill.rows[0]) return;
  const remaining = {};
  for (const [category, row] of Object.entries(bill.rows[0].chargePayments)) {
    remaining[category] = { PRINCIPAL: cents(row.currentAmount), LATE_PENALTY: cents(row.penaltyAmount) };
  }
  const applications = await client.query(`SELECT x.id,x.amount_applied,a.charge_type,x.component FROM payment_applications x
    JOIN payment_charge_allocations a ON a.id=x.charge_allocation_id JOIN payment_submissions p ON p.id=a.payment_submission_id
    WHERE x.unit_bill_id=$1 ORDER BY p.verified_payment_date,p.id,x.id`, [billId]);
  for (const row of applications.rows) {
    const keep = Math.min(cents(row.amount_applied), remaining[row.charge_type][row.component]);
    remaining[row.charge_type][row.component] -= keep;
    if (!keep) await client.query('DELETE FROM payment_applications WHERE id=$1', [row.id]);
    else if (keep !== cents(row.amount_applied)) await client.query('UPDATE payment_applications SET amount_applied=$2 WHERE id=$1', [row.id,money(keep)]);
  }
}

async function recalculatePenalties(client, billId, asOfDate) {
  const today = asOfDate || new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Manila', year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date());
  // Acquire locks before reading balances; otherwise two approvals can use stale principal.
  await client.query(`SELECT u.id FROM units u WHERE EXISTS (SELECT 1 FROM unit_bills b
    WHERE b.unit_id=u.id AND ($1::bigint IS NULL OR b.id=$1)) ORDER BY u.id FOR UPDATE`, [billId]);
  const result = await client.query(`SELECT b.id,b.unit_id,b.late_penalty_amount,b.due_date_snapshot,b.late_penalty_percent_snapshot,
    COALESCE((SELECT ROUND(c.quantity*c.rate_applied,2) FROM bill_charges c WHERE c.unit_bill_id=b.id AND c.charge_type='ASSOCIATION_DUES'),0) AS principal,
    COALESCE((SELECT SUM(x.amount_applied) FROM payment_applications x JOIN payment_charge_allocations a ON a.id=x.charge_allocation_id
      JOIN payment_submissions p ON p.id=a.payment_submission_id WHERE x.unit_bill_id=b.id AND a.charge_type='ASSOCIATION_DUES'
      AND x.component='PRINCIPAL' AND p.verified_payment_date <= b.due_date_snapshot),0) AS paid
    FROM unit_bills b WHERE ($1::bigint IS NULL OR b.id=$1) ORDER BY b.unit_id,b.id`, [billId]);
  const changed = [];
  for (const bill of result.rows) {
    const amount = calculateLatePenalty(Math.max(Number(bill.principal)-Number(bill.paid),0),bill.late_penalty_percent_snapshot,bill.due_date_snapshot < today);
    if (cents(amount) === cents(bill.late_penalty_amount)) continue;
    await client.query(`UPDATE unit_bills SET late_penalty_amount=$2,late_penalty_applied_at=CASE WHEN due_date_snapshot < $3::date THEN COALESCE(late_penalty_applied_at,NOW()) ELSE NULL END WHERE id=$1`,[bill.id,amount,today]);
    await trimBillApplications(client,bill.id);
    await client.query(`INSERT INTO audit_logs(actor_user_id,entity_name,entity_id,action,old_values,new_values,remarks)
      VALUES(NULL,'UNIT_BILL',$1,'ASSOCIATION_PENALTY_RECALCULATED',$2::jsonb,$3::jsonb,'One-time penalty on unpaid association dues at the due date.')`,
      [bill.id,JSON.stringify({latePenaltyAmount:Number(bill.late_penalty_amount)}),JSON.stringify({latePenaltyAmount:amount})]);
    changed.push({id:bill.id,latePenaltyAmount:amount});
  }
  return changed;
}

export async function applyDueLatePenalties(database, billId = null, asOfDate = null) {
  await ensurePaymentLedgerSchema(database);
  if (typeof database.connect === 'function' && typeof database.release !== 'function') {
    const client = await database.connect();
    try { await client.query('BEGIN'); const rows=await recalculatePenalties(client,billId,asOfDate); await client.query('COMMIT'); return rows; }
    catch(error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  return recalculatePenalties(database,billId,asOfDate);
}

export function allocateCredit({ billRemaining, paymentCredits }) {
  let remaining=cents(billRemaining);
  const applications=[];
  for(const payment of paymentCredits || []) {
    const applied=Math.min(remaining,cents(payment.availableAmount));
    if(applied>0) applications.push({paymentSubmissionId:payment.paymentSubmissionId,amountApplied:money(applied)});
    remaining-=applied;
  }
  return {applications,remainingBalance:money(remaining)};
}
export function manualReference(paymentMethod,paymentId) {
  return `${paymentMethod === 'CASH' ? 'CASH' : paymentMethod.replaceAll('_','')}-${String(paymentId).padStart(8,'0')}`;
}
export async function getUnitCreditBalance(client,unitId) {
  const result=await client.query(`SELECT COALESCE(SUM(a.allocated_amount-COALESCE((SELECT SUM(x.amount_applied) FROM payment_applications x WHERE x.charge_allocation_id=a.id),0)),0) AS balance
    FROM payment_charge_allocations a JOIN payment_submissions p ON p.id=a.payment_submission_id WHERE p.unit_id=$1 AND p.review_status='APPROVED'`,[unitId]);
  return Number(result.rows[0]?.balance || 0);
}

export async function createPaymentAllocations(client,paymentId) {
  const source=(await client.query('SELECT unit_id FROM payment_submissions WHERE id=$1',[paymentId])).rows[0];
  if(!source) throw Object.assign(new Error('Payment not found.'),{status:404});
  await lockUnit(client,source.unit_id);
  const result=await client.query('SELECT * FROM payment_submissions WHERE id=$1 FOR UPDATE',[paymentId]);
  const payment=result.rows[0];
  let balance={};
  if(payment.target_unit_bill_id) {
    await applyDueLatePenalties(client,payment.target_unit_bill_id);
    balance=(await client.query(`SELECT ${chargePaymentsSql} AS charges FROM unit_bills b WHERE b.id=$1 AND b.unit_id=$2`,[payment.target_unit_bill_id,payment.unit_id])).rows[0]?.charges;
    if(!balance) throw Object.assign(new Error('SOA does not belong to this unit.'),{status:400});
  }
  const allocations=allocatePaymentPurpose({paymentPurpose:payment.payment_purpose,amount:payment.verified_amount,
    associationRemaining:await prospectiveAssociationBalance(client, payment, balance),waterRemaining:balance.WATER?.remainingBalance || 0});
  for(const row of allocations) await client.query('INSERT INTO payment_charge_allocations(payment_submission_id,charge_type,allocated_amount) VALUES($1,$2,$3)',[paymentId,row.chargeType,row.allocatedAmount]);
  if(payment.target_unit_bill_id) {
    // Reorder only this SOA's applications when a proof is approved with an earlier date.
    // Existing budgets and invoice references never change and other SOAs are untouched.
    const sources = await client.query(`SELECT DISTINCT charge_allocation_id AS id FROM payment_applications WHERE unit_bill_id=$1
      UNION SELECT id FROM payment_charge_allocations WHERE payment_submission_id=$2`, [payment.target_unit_bill_id,paymentId]);
    const ids=sources.rows.map(row=>row.id);
    await client.query('DELETE FROM payment_applications WHERE unit_bill_id=$1',[payment.target_unit_bill_id]);
    await applyUnitCreditToBill(client,payment.target_unit_bill_id,null,ids);
    await applyDueLatePenalties(client,payment.target_unit_bill_id);
    await applyUnitCreditToBill(client,payment.target_unit_bill_id,null,ids);
  }
  return allocations;
}

export async function previewPaymentAllocations(client,payment) {
  let balance={};
  if(payment.target_unit_bill_id) {
    balance=(await client.query(`SELECT ${chargePaymentsSql} AS charges FROM unit_bills b WHERE b.id=$1 AND b.unit_id=$2`,[payment.target_unit_bill_id,payment.unit_id])).rows[0]?.charges;
    if(!balance) throw Object.assign(new Error('SOA does not belong to this unit.'),{status:400});
  }
  return allocatePaymentPurpose({paymentPurpose:payment.payment_purpose,amount:payment.verified_amount,
    associationRemaining:await prospectiveAssociationBalance(client,payment,balance),waterRemaining:balance.WATER?.remainingBalance || 0});
}

async function prospectiveAssociationBalance(client,payment,balance) {
  const row=balance.ASSOCIATION_DUES;
  if(!row) return 0;
  if(payment.payment_purpose!=='COMBINED') return row.remainingBalance;
  const bill=(await client.query(`SELECT due_date_snapshot,late_penalty_percent_snapshot,
    COALESCE((SELECT SUM(x.amount_applied) FROM payment_applications x JOIN payment_charge_allocations a ON a.id=x.charge_allocation_id
    JOIN payment_submissions p ON p.id=a.payment_submission_id WHERE x.unit_bill_id=b.id AND a.charge_type='ASSOCIATION_DUES'
    AND x.component='PRINCIPAL' AND p.verified_payment_date<=b.due_date_snapshot),0) AS pre_due_paid
    FROM unit_bills b WHERE b.id=$1`,[payment.target_unit_bill_id])).rows[0];
  if(payment.verified_payment_date > bill.due_date_snapshot) return row.remainingBalance;
  const principal=Math.max(Number(row.currentAmount)-Number(row.principalPaid),0);
  const paidAtDue=Math.min(Number(row.currentAmount),Number(bill.pre_due_paid)+Math.min(Number(payment.verified_amount),principal));
  const revisedPenalty=Number(row.penaltyAmount)>0
    ? calculateLatePenalty(Number(row.currentAmount)-paidAtDue,bill.late_penalty_percent_snapshot,true) : 0;
  return Number((principal+Math.max(revisedPenalty-Number(row.penaltyPaid),0)).toFixed(2));
}

export async function applyUnitCreditToBill(client,billId,preferredPaymentId=null,allocationIds=null) {
  const bill=(await client.query('SELECT id,unit_id,period_start_snapshot,created_at FROM unit_bills WHERE id=$1',[billId])).rows[0];
  if(!bill) return {appliedAmount:0,remainingBalance:0};
  await lockUnit(client,bill.unit_id);
  const credits=await client.query(`SELECT a.*,p.verified_payment_date,
    a.allocated_amount-COALESCE((SELECT SUM(x.amount_applied) FROM payment_applications x WHERE x.charge_allocation_id=a.id),0) AS available
    FROM payment_charge_allocations a JOIN payment_submissions p ON p.id=a.payment_submission_id
    LEFT JOIN unit_bills target ON target.id=p.target_unit_bill_id
    WHERE p.unit_id=$1 AND p.review_status='APPROVED'
      AND ($2::bigint IS NULL OR p.id=$2)
      AND ($3::bigint[] IS NULL OR a.id=ANY($3))
      AND ($2::bigint IS NOT NULL OR $3::bigint[] IS NOT NULL OR
        (p.submitted_at <= (SELECT created_at FROM unit_bills WHERE id=$4) AND (target.id IS NULL OR target.period_start_snapshot < $5::date)))
    ORDER BY p.verified_payment_date,p.id,a.id`,[bill.unit_id,preferredPaymentId,allocationIds,bill.id,bill.period_start_snapshot]);
  let applied=0;
  for(const credit of credits.rows) {
    if(Number(credit.available)<=0) continue;
    const balances=(await client.query(`SELECT ${chargePaymentsSql} AS charges FROM unit_bills b WHERE b.id=$1`,[billId])).rows[0].charges;
    const row=balances[credit.charge_type];
    const allocation=allocateCategoryCredit({principalRemaining:Math.max(Number(row.currentAmount)-Number(row.principalPaid),0),
      penaltyRemaining:Math.max(Number(row.penaltyAmount)-Number(row.penaltyPaid),0),availableAmount:Number(credit.available)});
    for(const [component,amount] of [['PRINCIPAL',allocation.principal],['LATE_PENALTY',allocation.penalty]]) {
      if(!amount) continue;
      await client.query('INSERT INTO payment_applications(payment_submission_id,unit_bill_id,charge_allocation_id,component,amount_applied) VALUES($1,$2,$3,$4,$5)',[credit.payment_submission_id,billId,credit.id,component,amount]);
      applied+=cents(amount);
    }
  }
  const totals=(await client.query(`SELECT GREATEST(${billTotalSql}-${billAppliedSql},0) AS remaining FROM unit_bills b WHERE b.id=$1`,[billId])).rows[0];
  return {appliedAmount:money(applied),remainingBalance:Number(totals.remaining)};
}

export async function reconcileBillPayments(client,billId) {
  const source=(await client.query('SELECT unit_id FROM unit_bills WHERE id=$1',[billId])).rows[0];
  if(!source) return;
  await lockUnit(client,source.unit_id);
  const ids=(await client.query(`SELECT DISTINCT charge_allocation_id AS id FROM payment_applications WHERE unit_bill_id=$1
    UNION SELECT a.id FROM payment_charge_allocations a JOIN payment_submissions p ON p.id=a.payment_submission_id WHERE p.target_unit_bill_id=$1`,[billId])).rows.map(row=>row.id);
  await client.query('DELETE FROM payment_applications WHERE unit_bill_id=$1',[billId]);
  await applyDueLatePenalties(client,billId);
  if(ids.length) {
    await applyUnitCreditToBill(client,billId,null,ids);
    await applyDueLatePenalties(client,billId);
    await applyUnitCreditToBill(client,billId,null,ids);
  }
}
export async function applyUnitCreditToOpenBills(client,unitId,preferredBillId=null,preferredPaymentId=null) {
  await lockUnit(client,unitId);
  return preferredBillId ? (await applyUnitCreditToBill(client,preferredBillId,preferredPaymentId)).appliedAmount : 0;
}
export { billAppliedSql,billBaseTotalSql,billLatePenaltySql,billTotalSql,paymentAppliedSql };
