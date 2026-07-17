BEGIN;

DO $$
DECLARE
  target_count BIGINT;
  copied_count BIGINT;
BEGIN
  IF to_regclass('public.payment_submission_targets') IS NOT NULL THEN
    SELECT COUNT(*) INTO target_count FROM payment_submission_targets;
    SELECT COUNT(*)
    INTO copied_count
    FROM payment_submission_targets pst
    JOIN payment_submissions ps
      ON ps.id = pst.payment_submission_id
     AND ps.target_unit_bill_id = pst.unit_bill_id;

    IF target_count <> copied_count THEN
      RAISE EXCEPTION 'Refusing to drop payment_submission_targets: copied % of % target row(s)', copied_count, target_count;
    END IF;
  END IF;
END;
$$;

DROP TABLE IF EXISTS payment_submission_targets;

COMMIT;
