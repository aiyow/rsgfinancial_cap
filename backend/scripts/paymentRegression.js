// Explicitly opt-in database regression. All fixture writes and migration DDL roll back.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import pool from '../config/db.js';
import { createPaymentAllocations, applyDueLatePenalties, applyUnitCreditToBill, reconcileBillPayments, chargePaymentsSql, lockUnit } from '../services/paymentLedger.js';
import { getFinancialReport,parseFinancialReportFilters } from '../services/financialReports.js';
import { runPaymentHttpRegression } from '../test/helpers/paymentHttpRegression.js';

if (!process.argv.includes('--current-rollback')) throw new Error('Requires --current-rollback. Tests never commit fixtures.');
const client = await pool.connect();
const counts = async () => (await client.query(`SELECT (SELECT COUNT(*) FROM payment_submissions)::int AS payments,
  (SELECT COUNT(*) FROM payment_applications)::int AS applications,(SELECT COUNT(*) FROM unit_bills)::int AS bills,
  (SELECT COUNT(*) FROM audit_logs)::int AS audits,
  (SELECT COUNT(*) FROM user_notifications)::int AS notifications`)).rows[0];
const before = await counts();
let passed = 0;
try {
  await client.query('BEGIN');
  const migration = await readFile(new URL('../database/migrations/033_category_payment_ledger.sql', import.meta.url), 'utf8');
  await client.query(migration.replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, ''));
  const source = (await client.query(`SELECT b.id,b.unit_id,b.billing_period_id FROM unit_bills b
    WHERE EXISTS(SELECT 1 FROM bill_charges c WHERE c.unit_bill_id=b.id AND c.charge_type='WATER')
    ORDER BY b.id DESC LIMIT 1`)).rows[0];
  const actor = (await client.query("SELECT id FROM users WHERE role='ADMIN' AND is_active=TRUE ORDER BY id LIMIT 1")).rows[0];
  assert.ok(source && actor, 'An existing SOA and Admin are required for rolled-back fixtures.');
  await lockUnit(client, source.unit_id);
  async function reset(association = 1608.84, water = 58.90, due = '2099-01-19', percent = 0) {
    await client.query(`UPDATE unit_bills SET due_date_snapshot=$2,late_penalty_percent_snapshot=$3,
      late_penalty_amount=0,late_penalty_applied_at=NULL WHERE id=$1`,[source.id,due,percent]);
    await client.query(`UPDATE bill_charges SET quantity=1,rate_applied=CASE WHEN charge_type='WATER' THEN $2::numeric ELSE $3::numeric END
      WHERE unit_bill_id=$1`,[source.id,water,association]);
  }
  async function pay(purpose, amount, date='2026-10-01', bill=source.id) {
    const id=(await client.query(`INSERT INTO payment_submissions(unit_id,submitted_by,target_unit_bill_id,entry_type,payment_method,
      review_status,reviewed_by,reviewed_at,verified_amount,verified_reference_no,verified_payment_date,payment_purpose)
      VALUES($1,$2,$3,'MANUAL','CASH','APPROVED',$2,NOW(),$4,$5,$6,$7) RETURNING id`,
      [source.unit_id,actor.id,bill,amount,`TEST-${crypto.randomUUID()}`,date,purpose])).rows[0].id;
    await createPaymentAllocations(client,id); return id;
  }
  async function charges(id=source.id) {
    return (await client.query(`SELECT ${chargePaymentsSql} AS charges FROM unit_bills b WHERE b.id=$1`,[id])).rows[0].charges;
  }
  async function check(name, run) {
    await client.query('SAVEPOINT regression_case');
    await client.query('SET CONSTRAINTS ALL DEFERRED');
    await reset();
    await run();
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('ROLLBACK TO SAVEPOINT regression_case');
    await client.query('RELEASE SAVEPOINT regression_case');
    passed++; console.log(`PASS ${name}`);
  }
  await check('acceptance: water clears only water; overall remains partial; invoice stays water-only',async()=>{
    const id=await pay('WATER',58.90);
    await client.query("UPDATE payment_charge_allocations SET invoice_number='W-123' WHERE payment_submission_id=$1",[id]);
    const rows=await charges(); assert.equal(rows.WATER.remainingBalance,0); assert.equal(rows.WATER.approvedAmount,58.9);
    assert.equal(rows.ASSOCIATION_DUES.remainingBalance,1608.84); assert.deepEqual(rows.WATER.invoiceReferences,['W-123']);
    assert.deepEqual(rows.ASSOCIATION_DUES.invoiceReferences,[]);
  });
  await check('combined partial is association first; full combined settles both',async()=>{
    await pay('COMBINED',1000); let rows=await charges(); assert.equal(rows.WATER.approvedAmount,0); assert.equal(rows.ASSOCIATION_DUES.remainingBalance,608.84);
    const id=await pay('COMBINED',667.74); await client.query("UPDATE payment_charge_allocations SET invoice_number='SHARED' WHERE payment_submission_id=$1",[id]);
    rows=await charges(); assert.equal(rows.WATER.remainingBalance,0); assert.equal(rows.ASSOCIATION_DUES.remainingBalance,0);
    assert.deepEqual(rows.WATER.invoiceReferences,['SHARED']); assert.deepEqual(rows.ASSOCIATION_DUES.invoiceReferences,['SHARED']);
  });
  await check('multiple partial invoices and independent advances',async()=>{
    const first=await pay('WATER',20),second=await pay('WATER',100); await pay('ASSOCIATION_DUES',1700);
    await client.query("UPDATE payment_charge_allocations SET invoice_number=CASE WHEN payment_submission_id=$1 THEN 'W-A' ELSE 'W-B' END WHERE payment_submission_id=ANY($2::bigint[])",[first,[first,second]]);
    const rows=await charges(); assert.equal(rows.WATER.advanceBalance,61.1); assert.equal(rows.ASSOCIATION_DUES.advanceBalance,91.16);
    assert.deepEqual(rows.WATER.invoiceReferences.sort(),['W-A','W-B']);
  });
  await check('combined excess is association advance; approval leaves other SOAs untouched',async()=>{
    await pay('COMBINED',1800); const rows=await charges(); assert.equal(rows.WATER.advanceBalance,0); assert.equal(rows.ASSOCIATION_DUES.advanceBalance,132.26);
    assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM payment_applications WHERE unit_bill_id<>$1',[source.id])).rows[0].count,0);
  });
  await check('future generation applies designated credits only; no current-SOA silent credit sweep',async()=>{
    await pay('WATER',100,null || '2026-10-01',null); await pay('ASSOCIATION_DUES',200,'2026-10-01',null);
    const id=await pay('WATER',10); assert.equal((await charges()).WATER.approvedAmount,10);
    const period=(await client.query('SELECT id FROM billing_periods WHERE id<>$1 AND NOT EXISTS(SELECT 1 FROM unit_bills WHERE billing_period_id=billing_periods.id AND unit_id=$2) ORDER BY id LIMIT 1',[source.billing_period_id,source.unit_id])).rows[0];
    assert.ok(period,'A second existing billing period is needed for the rolled-back future SOA.');
    const columns=(await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='unit_bills' AND column_name<>'id' AND is_generated='NEVER' ORDER BY ordinal_position")).rows.map(row=>row.column_name);
    const overrides={billing_period_id:'$2',period_start_snapshot:"'2099-02-01'::date",period_end_snapshot:"'2099-03-01'::date",due_date_snapshot:"'2099-03-19'::date",created_at:'NOW()'};
    const copied=(await client.query(`INSERT INTO unit_bills(${columns.map(c=>`"${c}"`).join(',')}) SELECT ${columns.map(c=>overrides[c] || `"${c}"`).join(',')} FROM unit_bills WHERE id=$1 RETURNING id`,[source.id,period.id])).rows[0].id;
    await client.query('INSERT INTO bill_charges(unit_bill_id,charge_type,quantity,rate_applied) VALUES($1,\'WATER\',1,150),($1,\'ASSOCIATION_DUES\',1,300)',[copied]);
    await applyUnitCreditToBill(client,copied); const future=await charges(copied);
    assert.equal(future.WATER.approvedAmount,100); assert.equal(future.ASSOCIATION_DUES.approvedAmount,200); assert.equal((await charges()).WATER.approvedAmount,10);
    assert.ok(id);
  });
  await check('association-only penalty after due date, never water, never compounded',async()=>{
    await reset(100,10,'2020-01-19',10); await applyDueLatePenalties(client,source.id);
    let rows=await charges(); assert.equal(rows.ASSOCIATION_DUES.penaltyAmount,10); assert.equal(rows.WATER.penaltyAmount,0);
    await applyDueLatePenalties(client,source.id); rows=await charges(); assert.equal(rows.ASSOCIATION_DUES.penaltyAmount,10);
    await pay('COMBINED',105,'2026-10-01'); rows=await charges(); assert.equal(rows.ASSOCIATION_DUES.remainingBalance,5); assert.equal(rows.WATER.approvedAmount,0);
  });
  await check('late approval of a pre-due partial proof recalculates the penalty',async()=>{
    await reset(100,10,'2020-01-19',10); await applyDueLatePenalties(client,source.id);
    await pay('ASSOCIATION_DUES',50,'2020-01-18'); const rows=await charges(); assert.equal(rows.ASSOCIATION_DUES.penaltyAmount,5); assert.equal(rows.ASSOCIATION_DUES.remainingBalance,55);
    assert.ok((await client.query("SELECT COUNT(*)::int AS count FROM audit_logs WHERE entity_id=$1 AND action='ASSOCIATION_PENALTY_RECALCULATED'",[source.id])).rows[0].count > 0);
  });
  await check('backdated combined full payment does not strand water behind a removed penalty',async()=>{
    await reset(100,10,'2020-01-19',10); await applyDueLatePenalties(client,source.id); await pay('COMBINED',110,'2020-01-18');
    const rows=await charges(); assert.equal(rows.ASSOCIATION_DUES.penaltyAmount,0); assert.equal(rows.WATER.remainingBalance,0); assert.equal(rows.ASSOCIATION_DUES.remainingBalance,0);
  });
  await check('paid SOA correction releases credit in its original category and retains invoices',async()=>{
    const id=await pay('COMBINED',1667.74); await client.query("UPDATE payment_charge_allocations SET invoice_number='KEEP' WHERE payment_submission_id=$1",[id]);
    await client.query("UPDATE bill_charges SET rate_applied=30 WHERE unit_bill_id=$1 AND charge_type='WATER'",[source.id]);
    await reconcileBillPayments(client,source.id); const rows=await charges(); assert.equal(rows.WATER.advanceBalance,28.9); assert.equal(rows.ASSOCIATION_DUES.advanceBalance,0);
    assert.deepEqual(rows.WATER.invoiceReferences,['KEEP']); assert.deepEqual(rows.ASSOCIATION_DUES.invoiceReferences,['KEEP']);
  });
  await check('zero charges and zero penalty percentage produce category advance only',async()=>{
    await reset(0,0,'2020-01-19',0); await pay('WATER',1); await applyDueLatePenalties(client,source.id);
    const rows=await charges(); assert.equal(rows.WATER.advanceBalance,1); assert.equal(rows.ASSOCIATION_DUES.penaltyAmount,0);
  });
  await check('duplicate references and repeated approval are rejected',async()=>{
    const id=await pay('WATER',10); await client.query('SAVEPOINT invalid_payment');
    await assert.rejects(createPaymentAllocations(client,id),error=>error.code==='23505'); await client.query('ROLLBACK TO SAVEPOINT invalid_payment');
    await client.query('SAVEPOINT duplicate_reference');
    await assert.rejects(client.query(`INSERT INTO payment_submissions(unit_id,submitted_by,target_unit_bill_id,entry_type,payment_method,review_status,reviewed_by,reviewed_at,verified_amount,verified_reference_no,verified_payment_date,payment_purpose)
      SELECT unit_id,submitted_by,target_unit_bill_id,entry_type,payment_method,review_status,reviewed_by,reviewed_at,verified_amount,verified_reference_no,verified_payment_date,payment_purpose FROM payment_submissions WHERE id=$1`,[id]),error=>error.code==='23505');
    await client.query('ROLLBACK TO SAVEPOINT duplicate_reference');
  });
  await check('database rejects category leakage and overapplication at transaction boundary',async()=>{
    const id=await pay('WATER',10); await client.query('SAVEPOINT invalid_allocation');
    await client.query("UPDATE payment_charge_allocations SET charge_type='ASSOCIATION_DUES' WHERE payment_submission_id=$1",[id]);
    await assert.rejects(client.query('SET CONSTRAINTS ALL IMMEDIATE'),error=>error.code==='23514'); await client.query('ROLLBACK TO SAVEPOINT invalid_allocation');
    await client.query('SAVEPOINT overapplication'); await client.query('UPDATE payment_applications SET amount_applied=100 WHERE payment_submission_id=$1',[id]);
    await assert.rejects(client.query('SET CONSTRAINTS ALL IMMEDIATE'),error=>error.code==='23514'); await client.query('ROLLBACK TO SAVEPOINT overapplication');
  });
  await check('reports count combined cash once and use exact category applications',async()=>{
    await pay('COMBINED',1667.74);
    const report=await getFinancialReport(client,parseFinancialReportFilters({month:'2026-10'}));
    assert.equal(report.overview.totalCollections,1667.74); assert.equal(report.overview.waterCollected,58.9);
    assert.equal(report.overview.duesCollected,1608.84); assert.equal(report.overview.latePenaltyCollected,0);
    assert.equal(report.paidDues.rows.length,1); assert.equal(report.paidDues.rows[0].combinedCollected,1667.74);
  });
  await check('pending and rejected proofs do not reduce balances; pending flag is category-specific',async()=>{
    const pending=(await client.query(`INSERT INTO payment_submissions(unit_id,submitted_by,target_unit_bill_id,entry_type,receipt_path,
      receipt_original_name,receipt_mime_type,receipt_sha256,ocr_quality_status,payment_purpose)
      VALUES($1,$2,$3,'RECEIPT_UPLOAD','test-only','test.png','image/png',$4,'GOOD','WATER') RETURNING id`,
      [source.unit_id,actor.id,source.id,crypto.randomBytes(32).toString('hex')])).rows[0].id;
    let rows=await charges(); assert.equal(rows.WATER.hasPendingPayment,true); assert.equal(rows.ASSOCIATION_DUES.hasPendingPayment,false);
    assert.equal(rows.WATER.remainingBalance,58.9);
    await client.query("UPDATE payment_submissions SET review_status='REJECTED',reviewed_by=$2,reviewed_at=NOW(),remarks='Test-only rejected proof' WHERE id=$1",[pending,actor.id]);
    rows=await charges(); assert.equal(rows.WATER.hasPendingPayment,false); assert.equal(rows.WATER.remainingBalance,58.9);
  });
  await check('reordering late-approved pre-due proofs releases late principal as association advance',async()=>{
    await reset(100,10,'2020-01-19',10); await pay('ASSOCIATION_DUES',110,'2026-10-01');
    await pay('ASSOCIATION_DUES',100,'2020-01-18'); const rows=await charges();
    assert.equal(rows.ASSOCIATION_DUES.penaltyAmount,0); assert.equal(rows.ASSOCIATION_DUES.advanceBalance,110); assert.equal(rows.WATER.remainingBalance,10);
  });
  await check('real APIs: preview, manual payment, invoices, permissions, repeated approval and notification rollback',async()=>{
    const resident=(await client.query("SELECT id FROM users WHERE role='RESIDENT' AND is_active=TRUE ORDER BY id LIMIT 1")).rows[0];
    await runPaymentHttpRegression(client,{billId:source.id,unitId:source.unit_id,adminId:actor.id,residentId:resident?.id});
  });
  await client.query('ROLLBACK');
  const contender=await pool.connect();
  try {
    await client.query('BEGIN'); await lockUnit(client,source.unit_id);
    await contender.query('BEGIN'); await contender.query("SET LOCAL lock_timeout='300ms'");
    await assert.rejects(lockUnit(contender,source.unit_id),error=>error.code==='55P03');
    await contender.query('ROLLBACK'); await client.query('ROLLBACK');
    await contender.query('BEGIN'); await lockUnit(contender,source.unit_id); await contender.query('ROLLBACK');
    passed++; console.log('PASS competing unit transactions serialize and locks release after rollback');
  } finally { await client.query('ROLLBACK'); await contender.query('ROLLBACK'); contender.release(); }
  assert.deepEqual(await counts(),before,'All payment, application, bill and audit fixture writes must roll back.');
  console.log(`${passed} database regression cases passed; fixture/migration changes rolled back.`);
} catch(error) { await client.query('ROLLBACK').catch(()=>{}); console.error(error); process.exitCode=1; }
finally { client.release(); await pool.end(); }
