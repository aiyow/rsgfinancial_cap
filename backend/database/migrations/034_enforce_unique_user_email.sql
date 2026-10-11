BEGIN;

-- Older installations can already contain duplicate registrations. Keep those
-- records intact, but prevent any additional account from using the same email.
-- The advisory lock closes the race where two registrations arrive together.
CREATE OR REPLACE FUNCTION normalize_and_enforce_user_email()
RETURNS TRIGGER AS $$
BEGIN
  NEW.email := LOWER(BTRIM(NEW.email));
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.email, 0));

  IF EXISTS (
    SELECT 1
    FROM users
    WHERE LOWER(BTRIM(email)) = NEW.email
      AND id <> NEW.id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'unique_violation',
      CONSTRAINT = 'users_email_lower_unique',
      MESSAGE = 'That email address is already registered.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_normalize_and_enforce_email ON users;

CREATE TRIGGER users_normalize_and_enforce_email
BEFORE INSERT OR UPDATE OF email ON users
FOR EACH ROW
EXECUTE FUNCTION normalize_and_enforce_user_email();

-- Fresh and cleaned-up databases also receive a native unique index. The
-- trigger above remains active for legacy databases until an administrator
-- removes their pre-existing duplicate account records.
DO $$
BEGIN
  IF to_regclass('users_email_lower_unique') IS NULL
     AND NOT EXISTS (
       SELECT 1
       FROM users
       GROUP BY LOWER(BTRIM(email))
       HAVING COUNT(*) > 1
     ) THEN
    EXECUTE 'CREATE UNIQUE INDEX users_email_lower_unique ON users (LOWER(BTRIM(email)))';
  END IF;
END;
$$;

COMMIT;
