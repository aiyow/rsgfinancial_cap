import pool from '../config/db.js';

const client = await pool.connect();
try {
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const policy = await client.query("SELECT to_regclass('payment_ledger_policy') AS policy");
  const active = policy.rows[0].policy ? (await client.query('SELECT version FROM payment_ledger_policy WHERE id = 1')).rows[0]?.version === 2 : false;
  const submissions = await client.query('SELECT id, review_status AS status, target_unit_bill_id AS "billId", unit_id AS "unitId" FROM payment_submissions ORDER BY id');
  const applications = await client.query('SELECT id, payment_submission_id AS "paymentId", unit_bill_id AS "billId", amount_applied AS amount FROM payment_applications ORDER BY id');
  const invoices = await client.query("SELECT id AS \"billId\" FROM unit_bills WHERE NULLIF(TRIM(invoice_number), '') IS NOT NULL ORDER BY id");
  const advances = await client.query(`SELECT ps.id AS "paymentId", ps.unit_id AS "unitId", ps.verified_amount - COALESCE(SUM(pa.amount_applied),0) AS amount
    FROM payment_submissions ps LEFT JOIN payment_applications pa ON pa.payment_submission_id=ps.id
    WHERE ps.review_status='APPROVED' GROUP BY ps.id HAVING ps.verified_amount > COALESCE(SUM(pa.amount_applied),0)`);
  const blocked = !active && Boolean(submissions.rowCount || applications.rowCount || invoices.rowCount);
  console.log(JSON.stringify({ policyActive: active, activationReady: !blocked, submissions: submissions.rows, applications: applications.rows, advances: advances.rows, legacyInvoiceBills: invoices.rows,
    message: blocked ? 'Activation blocked. Preserve/backup records and arrange the separately authorized cleanup. No data changed.' : 'No clean-start blockers, or category policy is already active.' }, null, 2));
  await client.query('ROLLBACK');
  if (blocked) process.exitCode = 2;
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Read-only preflight failed:', error.message);
  process.exitCode = 1;
} finally { client.release(); await pool.end(); }
