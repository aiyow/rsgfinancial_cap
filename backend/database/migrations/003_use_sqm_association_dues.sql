BEGIN;

ALTER TABLE units
ADD COLUMN IF NOT EXISTS billable_area_sqm NUMERIC(10, 2) NULL;

ALTER TABLE billing_periods
ADD COLUMN IF NOT EXISTS association_dues_rate_per_sqm NUMERIC(12, 2) NULL;

-- The June 2026 SOA establishes the applicable rate as PHP 134.07 per sqm.
UPDATE billing_periods
SET association_dues_rate_per_sqm = 134.07
WHERE association_dues_rate_per_sqm IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'units_billable_area_check'
    ) THEN
        ALTER TABLE units
        ADD CONSTRAINT units_billable_area_check
        CHECK (billable_area_sqm IS NULL OR billable_area_sqm > 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'billing_periods_association_rate_check'
    ) THEN
        ALTER TABLE billing_periods
        ADD CONSTRAINT billing_periods_association_rate_check
        CHECK (association_dues_rate_per_sqm >= 0);
    END IF;
END;
$$;

ALTER TABLE billing_periods
ALTER COLUMN association_dues_rate_per_sqm SET NOT NULL;

-- Historical generated charges retain their applied quantity and rate.
ALTER TABLE units
DROP COLUMN IF EXISTS association_dues_rate;

COMMIT;
