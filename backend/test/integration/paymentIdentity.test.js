import assert from 'node:assert/strict';
import test from 'node:test';
import pool from '../../config/db.js';
import { paymentResidentNameSql } from '../../services/paymentIdentity.js';

test('manual and advance payments resolve the resident without changing the staff recorder', async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TEMP TABLE users (id BIGINT, full_name TEXT, role TEXT) ON COMMIT DROP;
      CREATE TEMP TABLE unit_assignments (id BIGINT, unit_id BIGINT, user_id BIGINT, is_primary_payer BOOLEAN, start_date DATE, end_date DATE) ON COMMIT DROP;
      CREATE TEMP TABLE unit_bills (id BIGINT, payer_name_snapshot TEXT) ON COMMIT DROP;
      CREATE TEMP TABLE payment_submissions (id BIGINT, unit_id BIGINT, submitted_by BIGINT, target_unit_bill_id BIGINT, entry_type TEXT, verified_payment_date DATE, submitted_at TIMESTAMPTZ) ON COMMIT DROP`);
    await client.query(`INSERT INTO users VALUES (1,'Admin Recorder','ADMIN'), (2,'Primary Resident','RESIDENT'),
      (3,'Tenant Uploader','RESIDENT'), (4,'Previous Resident','RESIDENT'), (5,'New Resident','RESIDENT');
      INSERT INTO unit_assignments VALUES (1,10,2,TRUE,'2026-01-01',NULL), (2,10,3,FALSE,'2026-01-01',NULL),
      (3,20,4,TRUE,'2026-01-01','2026-09-30'), (4,20,5,TRUE,'2026-10-01',NULL),
      (5,30,2,TRUE,'2026-10-05',NULL), (6,40,1,TRUE,'2026-01-01',NULL);
      INSERT INTO unit_bills VALUES (1,'SOA Resident Snapshot'), (2,'  ');
      INSERT INTO payment_submissions VALUES
        (1,10,1,NULL,'MANUAL','2026-10-17','2026-10-17T10:00:00Z'),
        (2,10,1,1,'MANUAL','2026-10-17','2026-10-17T10:00:00Z'),
        (3,10,3,1,'RECEIPT_UPLOAD','2026-10-17','2026-10-17T10:00:00Z'),
        (4,20,1,NULL,'MANUAL','2026-09-15','2026-10-17T10:00:00Z'),
        (5,20,1,NULL,'MANUAL','2026-10-17','2026-10-17T10:00:00Z'),
        (6,99,1,NULL,'MANUAL','2026-10-17','2026-10-17T10:00:00Z'),
        (7,30,1,NULL,'MANUAL',NULL,'2026-10-04T16:30:00Z'),
        (8,30,1,NULL,'MANUAL','2026-10-04','2026-10-17T10:00:00Z'),
        (9,40,1,NULL,'MANUAL','2026-10-17','2026-10-17T10:00:00Z'),
        (10,10,1,2,'MANUAL','2026-10-17','2026-10-17T10:00:00Z')`);
    const result = await client.query(`SELECT ps.id, ${paymentResidentNameSql} AS "residentName", submitter.full_name AS "submittedByName"
      FROM payment_submissions ps
      LEFT JOIN unit_bills b ON b.id = ps.target_unit_bill_id
      LEFT JOIN users submitter ON submitter.id = ps.submitted_by ORDER BY ps.id`);
    assert.deepEqual(result.rows.map(row => row.residentName), [
      'Primary Resident', 'SOA Resident Snapshot', 'Tenant Uploader', 'Previous Resident', 'New Resident',
      'Unassigned unit', 'Primary Resident', 'Unassigned unit', 'Unassigned unit', 'Primary Resident',
    ]);
    assert.equal(result.rows[0].submittedByName, 'Admin Recorder');
    assert.equal(result.rows[2].submittedByName, 'Tenant Uploader');
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
