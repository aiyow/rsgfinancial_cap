BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20);

-- Existing accounts stay usable; only accounts created after this change wait
-- for an administrator to approve them.
UPDATE users
SET approval_status = 'APPROVED'
WHERE approval_status IS NULL;

ALTER TABLE users
  ALTER COLUMN approval_status SET DEFAULT 'APPROVED',
  ALTER COLUMN approval_status SET NOT NULL;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_approval_status_check,
  ADD CONSTRAINT users_approval_status_check
    CHECK (approval_status IN ('PENDING', 'APPROVED'));

CREATE INDEX IF NOT EXISTS users_approval_status_idx
  ON users (approval_status);

COMMIT;
