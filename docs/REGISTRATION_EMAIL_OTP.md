# Verified-email registration

Self-service signup now follows **Email → six-digit OTP → name/password → Admin approval**. It creates no user account before the email is verified. Existing Admin-created accounts keep their separate authorized creation path.

## Server guarantees

- Codes expire after 10 minutes and permit at most five wrong attempts. OTP hashes are keyed with `JWT_SECRET` and bound to the email and random challenge ID.
- The same browser tab restores an unexpired OTP challenge after Back/Forward or refresh using only email, challenge ID and expiry/cooldown timestamps in session storage. OTPs, passwords and registration grants are never saved there. Changing email, successful verification or successful signup clears that saved challenge.
- During cooldown, requesting an email with a live, unused, unlocked challenge returns its existing challenge metadata so the user can enter the already-sent code. It does not send another email or reset attempts/expiry.
- Resends require 60 seconds and invalidate the previous code and any previously issued registration grant. Failed delivery rolls back the replacement challenge.
- Successful verification invalidates the code and returns a random, email-bound registration grant valid for 10 minutes. The browser keeps it only in memory.
- `POST /api/auth/register` requires that grant. Its consumption, user creation and Admin notifications commit atomically, so failed creation can be retried and concurrent requests cannot reuse a grant.
- New users are `RESIDENT`, `email_verified=TRUE`, `approval_status=PENDING`. Email verification alone does not approve an account. Login, authenticated routes and recovery require Admin approval. Legacy email links verify email without approving an account.
- Temporary challenge records contain email and verification metadata only, never names or passwords. Passwords enter the account table only as password hashes after successful signup. A cleanup runs on startup and every 15 minutes to remove expired challenges and quota records.

## Request limits

Durable Postgres counters are shared across app instances and restarts. They store HMAC identifiers rather than raw IP addresses. Limits apply to attempts, including failed requests:

| Action | Limit |
| --- | --- |
| Send/resend per IP | 20 per hour |
| Send/resend per email | 5 per hour |
| OTP verification per IP | 60 per 15 minutes, plus 5 wrong attempts per code |
| Final account creation per IP | 10 per hour |

The browser cooldown is informational. All limits, expiry, OTP validation and grant consumption are enforced on the server.

## Setup and deployment

Run `npm run accounts:migrate-registration` from backend for migration **039**. It only adds `registration_challenges` and `registration_rate_limits`; it does not alter existing accounts. This migration has already been applied to the configured development Neon database. Apply it separately to any other deployment database before releasing the new server.

Keep the existing `JWT_SECRET` and SMTP settings configured. The migration uses a direct Neon connection, and integration tests use a separate disposable schema with direct connections. Never change `search_path` through the application pooler.

Registration uses email OTP verification and the server-side request limits above. No CAPTCHA integration is used.

Behind a known reverse proxy, set `TRUST_PROXY_HOPS` to the actual number of trusted hops (for example 1 for a single trusted proxy), and ensure the app cannot also be reached through a shorter untrusted path. Otherwise leave it unset; forwarded headers are not trusted by default. Shared resident networks may need quota tuning based on actual traffic.

## Validation

- `npm run test:registration` in backend: real HTTP, PostgreSQL constraints, limits, rollback, concurrency and separate approval, with intercepted SMTP and disposable records only.
- `npm test` in backend/frontend: regression suites.
- `node test/browser/registrationOtp.mjs` in frontend with Vite running: all API calls are mocked; covers gating, errors, changed email, expired proof, Admin approval and mobile screens. Set `PLAYWRIGHT_MODULE` to an installed module path if needed.
- Frontend build and targeted ESLint.

No real account is created or changed and no real message is sent during automated validation. A successful SMTP submission by itself is not proof that an address exists: only entering the emailed code proves access to that inbox. OTP and rate limits reduce abuse; Admin review is still needed to establish residency.
