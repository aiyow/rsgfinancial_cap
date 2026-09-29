BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_reset_token_hash VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS password_reset_last_sent_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS users_password_reset_token_hash_idx
  ON users (password_reset_token_hash)
  WHERE password_reset_token_hash IS NOT NULL;

COMMIT;
