CREATE TABLE IF NOT EXISTS public.login_trusted_browsers (
  id UUID PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  auth_version INTEGER NOT NULL,
  public_key TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS login_trusted_browsers_expiry_idx ON public.login_trusted_browsers(expires_at);
CREATE INDEX IF NOT EXISTS login_trusted_browsers_user_idx ON public.login_trusted_browsers(user_id);

CREATE TABLE IF NOT EXISTS public.login_challenges (
  id UUID PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  auth_version INTEGER NOT NULL,
  trusted_browser_id UUID REFERENCES public.login_trusted_browsers(id) ON DELETE CASCADE,
  otp_hash CHAR(64),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK ((trusted_browser_id IS NULL) <> (otp_hash IS NULL))
);

CREATE INDEX IF NOT EXISTS login_challenges_expiry_idx ON public.login_challenges(expires_at);
CREATE INDEX IF NOT EXISTS login_challenges_user_idx ON public.login_challenges(user_id);
CREATE INDEX IF NOT EXISTS login_challenges_browser_idx ON public.login_challenges(trusted_browser_id);
