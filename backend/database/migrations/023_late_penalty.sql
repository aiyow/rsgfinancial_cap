BEGIN;

ALTER TABLE billing_periods
ADD COLUMN IF NOT EXISTS late_penalty_percent NUMERIC(5, 2) NOT NULL DEFAULT 0;

ALTER TABLE unit_bills
ADD COLUMN IF NOT EXISTS late_penalty_percent_snapshot NUMERIC(5, 2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS late_penalty_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS late_penalty_applied_at TIMESTAMPTZ NULL;

ALTER TABLE billing_periods DROP CONSTRAINT IF EXISTS billing_periods_late_penalty_percent_check;
ALTER TABLE billing_periods
ADD CONSTRAINT billing_periods_late_penalty_percent_check
CHECK (late_penalty_percent >= 0 AND late_penalty_percent <= 100);

ALTER TABLE unit_bills DROP CONSTRAINT IF EXISTS unit_bills_late_penalty_percent_snapshot_check;
ALTER TABLE unit_bills
ADD CONSTRAINT unit_bills_late_penalty_percent_snapshot_check
CHECK (late_penalty_percent_snapshot >= 0 AND late_penalty_percent_snapshot <= 100);

ALTER TABLE unit_bills DROP CONSTRAINT IF EXISTS unit_bills_late_penalty_amount_check;
ALTER TABLE unit_bills
ADD CONSTRAINT unit_bills_late_penalty_amount_check
CHECK (late_penalty_amount >= 0);

COMMIT;
