BEGIN;

ALTER TABLE audit_logs
  ALTER COLUMN actor_user_id DROP NOT NULL;

ALTER TABLE audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_actor_fk;

ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_actor_fk
    FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL;

COMMIT;
