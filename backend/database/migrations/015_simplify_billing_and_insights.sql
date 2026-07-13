BEGIN;

-- Replace the analytics-only flag with an explicit period classification.
ALTER TABLE billing_periods
ADD COLUMN IF NOT EXISTS period_type VARCHAR(30) NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'billing_periods'
      AND column_name = 'analytics_only'
  ) THEN
    UPDATE billing_periods
    SET period_type = CASE
      WHEN analytics_only = TRUE THEN 'HISTORICAL_ANALYTICS'
      ELSE 'LIVE_BILLING'
    END
    WHERE period_type IS NULL;
  END IF;
END;
$$;

UPDATE billing_periods
SET period_type = 'LIVE_BILLING'
WHERE period_type IS NULL;

ALTER TABLE billing_periods
DROP CONSTRAINT IF EXISTS billing_periods_period_type_check;

ALTER TABLE billing_periods
ALTER COLUMN period_type SET DEFAULT 'LIVE_BILLING',
ALTER COLUMN period_type SET NOT NULL,
ADD CONSTRAINT billing_periods_period_type_check
  CHECK (period_type IN ('LIVE_BILLING', 'HISTORICAL_ANALYTICS'));

ALTER TABLE billing_periods
DROP COLUMN IF EXISTS analytics_only;

CREATE INDEX IF NOT EXISTS billing_periods_type_start_idx
ON billing_periods(period_type, period_start DESC);

-- Preserve billing history in the canonical audit table before removing the
-- billing-specific event table.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'billing_events'
  ) THEN
    INSERT INTO audit_logs
      (actor_user_id, entity_name, entity_id, action, old_values, new_values, remarks, created_at)
    SELECT
      be.actor_id,
      CASE WHEN be.unit_bill_id IS NOT NULL OR be.event_type = 'SOA_EDITED'
        THEN 'UNIT_BILL' ELSE 'BILLING_PERIOD' END,
      COALESCE(
        be.unit_bill_id,
        be.billing_period_id,
        CASE WHEN COALESCE(be.details->'after'->>'id', '') ~ '^[0-9]+$'
          THEN (be.details->'after'->>'id')::BIGINT ELSE NULL END,
        CASE WHEN COALESCE(be.details->'before'->>'id', '') ~ '^[0-9]+$'
          THEN (be.details->'before'->>'id')::BIGINT ELSE NULL END,
        CASE WHEN COALESCE(be.details->>'id', '') ~ '^[0-9]+$'
          THEN (be.details->>'id')::BIGINT ELSE NULL END
      ),
      be.event_type,
      CASE WHEN be.event_type = 'SOA_EDITED' THEN be.details->'before' ELSE NULL END,
      CASE WHEN be.event_type = 'SOA_EDITED'
        THEN COALESCE(be.details->'after', '{}'::jsonb)
        ELSE be.details END,
      be.reason,
      be.created_at
    FROM billing_events be;
  END IF;
END;
$$;

DROP TABLE IF EXISTS billing_events;

-- Keep only the current recommendation state; audit_logs records view/delete
-- activity, so a second action-history table is no longer needed.
DROP TABLE IF EXISTS prescriptive_recommendation_actions;

ALTER TABLE prescriptive_recommendations
DROP CONSTRAINT IF EXISTS prescriptive_recommendations_status_check;

UPDATE prescriptive_recommendations
SET status = CASE
  WHEN status = 'ACKNOWLEDGED' THEN 'VIEWED'
  WHEN status IN ('RESOLVED', 'DISMISSED') THEN 'SUPERSEDED'
  ELSE status
END;

ALTER TABLE prescriptive_recommendations
ADD CONSTRAINT prescriptive_recommendations_status_check
  CHECK (status IN ('OPEN', 'VIEWED', 'SUPERSEDED'));

-- Existing generated batches predate automatic visibility. Backfill their
-- active high-usage insights so current residents receive the same behavior
-- as future bill generations.
UPDATE prescriptive_recommendations r
SET resident_visible_at = COALESCE(r.resident_visible_at, NOW()),
    resident_visible_by = COALESCE(r.resident_visible_by, p.created_by),
    updated_at = NOW()
FROM billing_periods p
WHERE p.id = r.based_on_period_id
  AND p.period_type = 'LIVE_BILLING'
  AND p.status IN ('GENERATED', 'FORWARDED', 'CLOSED')
  AND r.recommendation_type = 'CHECK_HIGH_USAGE'
  AND r.status IN ('OPEN', 'VIEWED')
  AND r.resident_visible_at IS NULL;

COMMIT;
