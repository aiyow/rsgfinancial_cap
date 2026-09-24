BEGIN;

-- Replaces the original one-open-report rule. The API now enforces a maximum
-- of three reports per resident and SOA while holding the SOA row lock.
DROP INDEX IF EXISTS billing_error_reports_open_reporter_bill_unique;

COMMIT;
