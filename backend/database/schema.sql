CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  full_name VARCHAR(205) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'RESIDENT'
    CHECK (role IN ('ADMIN', 'COLLECTOR', 'RESIDENT')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  approval_status VARCHAR(20) NOT NULL DEFAULT 'APPROVED'
    CHECK (approval_status IN ('PENDING', 'APPROVED')),
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  email_verification_token_hash VARCHAR(64) NULL,
  email_verification_expires_at TIMESTAMPTZ NULL,
  email_verification_last_sent_at TIMESTAMPTZ NULL,
  password_reset_token_hash VARCHAR(64) NULL,
  password_reset_expires_at TIMESTAMPTZ NULL,
  password_reset_last_sent_at TIMESTAMPTZ NULL,
  auth_version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_email_verification_token_hash_idx
  ON users (email_verification_token_hash)
  WHERE email_verification_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_password_reset_token_hash_idx
  ON users (password_reset_token_hash)
  WHERE password_reset_token_hash IS NOT NULL;

-- Temporary email verification only: no user account or password is stored here.
CREATE TABLE IF NOT EXISTS public.registration_challenges (
  email VARCHAR(255) PRIMARY KEY,
  id UUID NOT NULL UNIQUE,
  otp_hash VARCHAR(64),
  verified_token_hash VARCHAR(64),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at TIMESTAMPTZ NOT NULL,
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS registration_challenges_expiry_idx ON public.registration_challenges(expires_at);

-- Shared, persistent quotas work across server restarts and multiple app instances.
CREATE TABLE IF NOT EXISTS public.registration_rate_limits (
  key_hash VARCHAR(64) PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS registration_rate_limits_expiry_idx ON public.registration_rate_limits(expires_at);
