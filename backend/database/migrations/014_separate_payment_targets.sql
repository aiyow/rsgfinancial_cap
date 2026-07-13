BEGIN;

-- A target SOA records where a payment was submitted for review. It is an
-- intention only; payment_applications remains the sole source of truth for
-- money that was actually allocated to bills.
CREATE TABLE IF NOT EXISTS payment_submission_targets (
    payment_submission_id BIGINT PRIMARY KEY,
    unit_bill_id BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT payment_submission_targets_payment_fk
      FOREIGN KEY (payment_submission_id) REFERENCES payment_submissions(id) ON DELETE CASCADE,
    CONSTRAINT payment_submission_targets_bill_fk
      FOREIGN KEY (unit_bill_id) REFERENCES unit_bills(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS payment_submission_targets_bill_idx
ON payment_submission_targets(unit_bill_id);

-- Preserve the target of all existing receipt and manual payments before
-- removing the old ambiguous link from payment_submissions.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'payment_submissions'
      AND column_name = 'unit_bill_id'
  ) THEN
    INSERT INTO payment_submission_targets (payment_submission_id, unit_bill_id)
    SELECT ps.id, ps.unit_bill_id
    FROM payment_submissions ps
    WHERE ps.unit_bill_id IS NOT NULL
    ON CONFLICT (payment_submission_id) DO NOTHING;
  END IF;
END;
$$;

ALTER TABLE payment_submissions
DROP CONSTRAINT IF EXISTS payment_submissions_bill_or_unit_check;

ALTER TABLE payment_submissions
DROP COLUMN IF EXISTS unit_bill_id;

ALTER TABLE payment_submissions
ALTER COLUMN unit_id SET NOT NULL;

COMMIT;
