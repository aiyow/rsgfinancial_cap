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
