CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'RESIDENT'
    CHECK (role IN ('ADMIN', 'COLLECTOR', 'RESIDENT')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  email_verification_token_hash VARCHAR(64) NULL,
  email_verification_expires_at TIMESTAMPTZ NULL,
  email_verification_last_sent_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique
  ON users (LOWER(email));

CREATE INDEX IF NOT EXISTS users_email_verification_token_hash_idx
  ON users (email_verification_token_hash)
  WHERE email_verification_token_hash IS NOT NULL;
