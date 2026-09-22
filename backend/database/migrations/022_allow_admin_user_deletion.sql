BEGIN;

-- Preserve the historical identity of an actor even when the user account is
-- permanently removed. New audit entries are populated by writeAuditLog().
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS actor_name_snapshot VARCHAR(150) NULL,
  ADD COLUMN IF NOT EXISTS actor_role_snapshot VARCHAR(20) NULL;

UPDATE audit_logs logs
SET actor_name_snapshot = COALESCE(logs.actor_name_snapshot, users.full_name),
    actor_role_snapshot = COALESCE(logs.actor_role_snapshot, users.role)
FROM users
WHERE users.id = logs.actor_user_id
  AND (logs.actor_name_snapshot IS NULL OR logs.actor_role_snapshot IS NULL);

ALTER TABLE audit_logs
  ALTER COLUMN actor_user_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS audit_logs_actor_fk;

ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_actor_fk
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Billing and meter history must remain after the creator or collector is
-- removed. The user reference becomes NULL while the historical row remains.
ALTER TABLE billing_periods
  ALTER COLUMN created_by DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS billing_periods_created_by_fk,
  DROP CONSTRAINT IF EXISTS billing_periods_created_by_fkey,
  DROP CONSTRAINT IF EXISTS billing_periods_forwarded_by_fk;

ALTER TABLE billing_periods
  ADD CONSTRAINT billing_periods_created_by_fk
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT billing_periods_forwarded_by_fk
  FOREIGN KEY (forwarded_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE meter_readings
  ALTER COLUMN recorded_by DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS meter_readings_recorded_by_fk;

ALTER TABLE meter_readings
  ADD CONSTRAINT meter_readings_recorded_by_fk
  FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE unit_bills
  ALTER COLUMN generated_by DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS unit_bills_generated_by_fk,
  DROP CONSTRAINT IF EXISTS unit_bills_published_by_fk;

ALTER TABLE unit_bills
  ADD CONSTRAINT unit_bills_generated_by_fk
  FOREIGN KEY (generated_by) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT unit_bills_published_by_fk
  FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL;

-- Keep receipt and approval history even when the submitting resident or
-- reviewing Admin is deleted. The approval still retains its date and amount.
ALTER TABLE payment_submissions
  ALTER COLUMN submitted_by DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS payment_submissions_submitter_fk,
  DROP CONSTRAINT IF EXISTS payment_submissions_reviewer_fk,
  DROP CONSTRAINT IF EXISTS payment_submissions_review_check;

ALTER TABLE payment_submissions
  ADD CONSTRAINT payment_submissions_submitter_fk
  FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT payment_submissions_reviewer_fk
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT payment_submissions_review_check CHECK (
    (review_status = 'PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR
    (review_status = 'APPROVED' AND reviewed_at IS NOT NULL
      AND verified_amount IS NOT NULL AND verified_reference_no IS NOT NULL AND verified_payment_date IS NOT NULL)
    OR
    (review_status = 'REJECTED' AND reviewed_at IS NOT NULL AND remarks IS NOT NULL)
  );

COMMIT;
