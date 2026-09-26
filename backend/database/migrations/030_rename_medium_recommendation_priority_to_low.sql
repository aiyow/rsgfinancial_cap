ALTER TABLE prescriptive_recommendations
  DROP CONSTRAINT IF EXISTS prescriptive_recommendations_priority_check;

UPDATE prescriptive_recommendations
SET priority = 'LOW'
WHERE priority = 'MEDIUM';

ALTER TABLE prescriptive_recommendations
  ADD CONSTRAINT prescriptive_recommendations_priority_check
  CHECK (priority IN ('HIGH', 'LOW'));
