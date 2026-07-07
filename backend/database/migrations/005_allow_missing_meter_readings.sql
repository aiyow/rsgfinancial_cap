BEGIN;

ALTER TABLE unit_bills
ALTER COLUMN previous_reading_snapshot DROP NOT NULL,
ALTER COLUMN current_reading_snapshot DROP NOT NULL;

ALTER TABLE unit_bills
ADD COLUMN IF NOT EXISTS generation_warning VARCHAR(255) NULL;

COMMIT;
