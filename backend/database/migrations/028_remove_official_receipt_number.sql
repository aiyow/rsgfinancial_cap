BEGIN;

DROP INDEX IF EXISTS unit_bills_official_receipt_number_unique;
ALTER TABLE unit_bills DROP COLUMN IF EXISTS official_receipt_number;

COMMIT;
