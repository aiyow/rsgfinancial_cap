BEGIN;

LOCK TABLE users IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM users
    GROUP BY LOWER(email)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot create case-insensitive email index: duplicate emails exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM users
    WHERE role::TEXT NOT IN ('ADMIN', 'COLLECTOR', 'UNIT_OWNER')
  ) THEN
    RAISE EXCEPTION
      'Cannot convert users.role: unsupported role values exist';
  END IF;
END
$$;

ALTER TABLE users
  ALTER COLUMN full_name TYPE VARCHAR(150);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE users
  ALTER COLUMN role DROP DEFAULT;

ALTER TABLE users
  ALTER COLUMN role TYPE VARCHAR(20) USING role::TEXT;

ALTER TABLE users
  ALTER COLUMN role SET DEFAULT 'UNIT_OWNER';

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('ADMIN', 'COLLECTOR', 'UNIT_OWNER'));

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_email_key;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique
  ON users (LOWER(email));

DROP TYPE IF EXISTS user_role;

COMMIT;
