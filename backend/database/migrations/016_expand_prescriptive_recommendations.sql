BEGIN;

ALTER TABLE prescriptive_recommendations
DROP CONSTRAINT IF EXISTS prescriptive_recommendations_type_check;

-- Datprescriptive_recommendationsabases created by the runtime schema helper use PostgreSQL's automatic
-- column-based name, while migration-created databases use the explicit name.
ALTER TABLE 
DROP CONSTRAINT IF EXISTS prescriptive_recommendations_recommendation_type_check;

ALTER TABLE prescriptive_recommendations
ADD CONSTRAINT prescriptive_recommendations_type_check
CHECK (recommendation_type IN (
  'REVIEW_METER_READING',
  'COLLECT_MORE_HISTORY',
  'CHECK_HIGH_USAGE',
  'VACANT_UNIT_USAGE',
  'RISING_CONSUMPTION',
  'PAYMENT_REMINDER',
  'MONITOR_HIGH_USAGE',
  'MONITOR_USAGE'
));

COMMIT;
