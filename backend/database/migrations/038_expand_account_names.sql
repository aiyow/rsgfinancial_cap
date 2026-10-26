BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
DECLARE target RECORD;
BEGIN
  FOR target IN
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND (table_name, column_name) IN (
        ('users', 'full_name'), ('unit_bills', 'payer_name_snapshot'),
        ('audit_logs', 'actor_name_snapshot'), ('soa_email_deliveries', 'recipient_name'),
        ('soa_reminder_deliveries', 'recipient_name')
      )
      AND data_type = 'character varying' AND character_maximum_length < 205
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I TYPE VARCHAR(205)',
      target.table_schema, target.table_name, target.column_name);
  END LOOP;
END $$;
COMMIT;
