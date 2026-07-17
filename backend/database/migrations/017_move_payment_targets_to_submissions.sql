BEGIN;

ALTER TABLE payment_submissions
  ADD COLUMN IF NOT EXISTS target_unit_bill_id BIGINT NULL;

DO $$
DECLARE
  target_count BIGINT;
  copied_count BIGINT;
  invalid_count BIGINT;
  mismatch_count BIGINT;
BEGIN
  IF to_regclass('public.payment_submission_targets') IS NOT NULL THEN
    SELECT COUNT(*)
    INTO invalid_count
    FROM payment_submission_targets pst
    JOIN payment_submissions ps ON ps.id = pst.payment_submission_id
    JOIN unit_bills b ON b.id = pst.unit_bill_id
    WHERE ps.unit_id IS DISTINCT FROM b.unit_id;

    IF invalid_count > 0 THEN
      RAISE EXCEPTION 'Cannot migrate payment targets: % target(s) point to a bill from another unit', invalid_count;
    END IF;

    UPDATE payment_submissions ps
    SET target_unit_bill_id = pst.unit_bill_id
    FROM payment_submission_targets pst
    WHERE pst.payment_submission_id = ps.id
      AND ps.target_unit_bill_id IS NULL;

    SELECT COUNT(*)
    INTO mismatch_count
    FROM payment_submission_targets pst
    JOIN payment_submissions ps ON ps.id = pst.payment_submission_id
    WHERE ps.target_unit_bill_id IS DISTINCT FROM pst.unit_bill_id;

    IF mismatch_count > 0 THEN
      RAISE EXCEPTION 'Cannot migrate payment targets: % target row(s) do not match payment_submissions.target_unit_bill_id', mismatch_count;
    END IF;

    SELECT COUNT(*) INTO target_count FROM payment_submission_targets;
    SELECT COUNT(*)
    INTO copied_count
    FROM payment_submission_targets pst
    JOIN payment_submissions ps
      ON ps.id = pst.payment_submission_id
     AND ps.target_unit_bill_id = pst.unit_bill_id;

    IF target_count <> copied_count THEN
      RAISE EXCEPTION 'Cannot migrate payment targets: copied % of % target row(s)', copied_count, target_count;
    END IF;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_submissions_target_bill_fk'
  ) THEN
    ALTER TABLE payment_submissions
      ADD CONSTRAINT payment_submissions_target_bill_fk
      FOREIGN KEY (target_unit_bill_id) REFERENCES unit_bills(id) ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS payment_submissions_target_bill_idx
  ON payment_submissions(target_unit_bill_id);

COMMIT;
