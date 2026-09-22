BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NULL,
  ADD COLUMN IF NOT EXISTS email_verification_token_hash VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS email_verification_last_sent_at TIMESTAMPTZ NULL;

-- Accounts created before email verification existed remain usable.
UPDATE users SET email_verified = TRUE WHERE email_verified IS NULL;

ALTER TABLE users
  ALTER COLUMN email_verified SET DEFAULT FALSE,
  ALTER COLUMN email_verified SET NOT NULL;

CREATE INDEX IF NOT EXISTS users_email_verification_token_hash_idx
  ON users (email_verification_token_hash)
  WHERE email_verification_token_hash IS NOT NULL;

COMMIT;
