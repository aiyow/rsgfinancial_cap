BEGIN;

ALTER TABLE billing_periods
ADD COLUMN IF NOT EXISTS analytics_only BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS readings_visible_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS billing_periods_analytics_visibility_idx
ON billing_periods(period_start, readings_visible_at)
WHERE readings_visible_at IS NOT NULL;

COMMIT;
