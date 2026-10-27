# Protected resident SOA email requests

The resident's **Request SOA** action emails an AES-256 revision 6 encrypted PDF attachment to the resident's current verified account email. After success, the button reads **SOA already sent in email**, stays disabled for 30 minutes, and shows no details panel beneath it. The existing statement viewer and payment reminder emails remain available.

## Email and password

The email includes a clean HTML layout and a plain-text alternative, a personal greeting, resident name, unit, billing period, due date, request reference, attachment filename, opening instructions, assistance guidance and a confidentiality notice. The attachment is named `SOA-SX-<reference>.pdf`. It contains the existing official statement layout.

The opening password is the requesting resident's surname in lowercase with spaces removed, followed by four cryptographically random decimal digits, including leading zeroes (for example, `kamado0042`). Accents, apostrophes and hyphens are preserved. The email explicitly gives both the four digits and the complete document password. It explains that passwords are case-sensitive and must match the attachment in that same email.

Accounts currently store only `full_name`, rather than a separate surname. The surname helper uses the final name component, including preceding common surname particles such as `de la`, `dela`, `del`, `san`, `van` and `von`, and excludes generational suffixes such as Jr. or III. Arbitrary compound surnames without those particles cannot be identified reliably from a complete name alone; the exact generated password is always provided in the email.

Each fresh request generates its password independently. With only four random digits, repeated values are possible. An independent random owner password is discarded. Opening passwords are never returned to the browser, saved in PostgreSQL, included in filenames or Activity Log, or passed in process arguments.

## API and lifecycle

- `POST /api/bills/:id/protected-exports`: resident bearer session, UUID `Idempotency-Key`, empty body. Recipient, name, billing values and PDF content are loaded server-side. Returns request metadata, never PDF bytes or a password.
- `GET /api/bills/:id/protected-exports`: authenticated resident-only cooldown/preparation status for an accessible statement. Does not send an email. Restores the sent button on reload or another tab. Successful receipts include `nextRequestAt`.
- `GET /api/soa-exports/:exportId`: authenticated owner-only request status.
- `GET /api/soa-exports/:exportId/file`: retained for compatibility but returns `410 SOA_EMAIL_ONLY` for an accessible request. It never serves PDF bytes, including for requests created before this change.

`PREPARING → EMAIL_PENDING → READY` marks success only after SMTP accepts the exact intended recipient. Rejection, timeout, uncertain delivery or generation failure produces `FAILED`, with a short retry message. SMTP acceptance cannot guarantee inbox delivery. The sent button's tooltip suggests checking Inbox/Spam and states the 30-minute waiting period.

Network retries reuse the same idempotency key. Concurrent requests for the same resident/SOA/current email share one in-progress request, even with different keys. Successful delivery enforces a **30-minute cooldown per resident, SOA and current email**, under the existing PostgreSQL resident advisory lock. New keys during that window return `429 SOA_EMAIL_COOLDOWN`, `Retry-After` and `nextRequestAt`. The cooldown uses the saved acceptance time and survives API/browser restarts and later invalidation of the historical document. After expiry, the enabled button creates a fresh key. Failed sends do not start the 30-minute cooldown. Existing abuse limits of 5 attempts/resident/hour, 60 seconds between new attempts, and 20 attempts/trusted IP/hour remain in place; failed attempts consume those quotas.

The protected email retains authenticated TLS, matching plain-text/HTML content, a normal PDF attachment, and no tracking pixels or automatic resend loop. `Auto-Submitted` and `X-Auto-Response-Suppress` mark it as an automated transactional message and discourage automatic reply loops; they do not bypass spam filters. The local SMTP check confirmed Gmail, TLS, and a From address matching the authenticated account. Custom sending domains require provider-side SPF/DKIM/DMARC configuration. Follow [Google's sender guidelines](https://support.google.com/mail/answer/81126); do not claim that SMTP acceptance or UI changes guarantee Inbox placement.

The PDF remains in memory while rendering, encrypting and sending. No new encrypted PDF is stored in PostgreSQL. Plaintext buffers and encrypted attachment buffers are cleared in `finally`. Legacy downloadable artifacts are expired and purged by request/startup maintenance. New READY email receipts have no portal retrieval deadline. Metadata is removed after 30 days, quota events after one hour, and abandoned PREPARING/EMAIL_PENDING requests fail after five minutes. A restart does not resume a delivery because no password or durable attachment outbox is retained.

Account eligibility, current verified email, active effective unit assignment, forwarded/closed period and published statement are checked server-side. A repeatable-read snapshot captures document inputs. Statement and email changes before delivery invalidate the request. The requesting resident's current name is checked again before sending; their name, rather than a different payer's name, determines the password and greeting.

## Deployment

No new database migration is needed if migration 043 is already installed. New environments must apply it with `npm run soa-exports:migrate`.

Deploy the backend and frontend together. Preserve the existing qpdf, fonts, logo and authenticated TLS SMTP configuration. Keep `SOA_PROTECTED_EXPORTS_ENABLED=true` only when deployment preflight passes. Run `npm run soa-exports:preflight` in the deployed backend image; it checks rendering, AES-256 R6 encryption, required opening password and SMTP negotiation without sending an email.

Local Windows development uses `QPDF_PATH` pointing to the installed qpdf executable. The backend Docker image supplies qpdf for deployment. SMTP requires a valid certificate and either implicit TLS on 465 (`SMTP_SECURE=true`) or required STARTTLS on 587 (`false`). Preserve the hosting service's working SMTP capability.

## Verification

- `npm run test:soa-exports` with `QPDF_PATH` configured: password rules, escaped HTML, attachment contents, TLS requirements, SMTP failures, real encryption, and isolated PostgreSQL HTTP tests. SMTP is intercepted; no live resident emails are sent. The actual encryption test skips when qpdf is absent.
- `node frontend/test/browser/protectedSoaDownloads.mjs` with Vite running and Playwright available: desktop/390px/320px layouts, compact disabled sent button without a success panel, 30-minute expiry, reload/new-tab recovery, server cooldown responses, pending polling, retry identity, verification and no downloads. Time is advanced in the test browser rather than waiting 30 minutes.
- Frontend production build and targeted ESLint.

Use staging to confirm actual inbox delivery and attachment opening in the supported PDF readers. Download the attachment from email, confirm a missing/wrong password fails, and open it using the exact emailed password. An emailed attachment remains accessible with its password; it cannot be remotely revoked or expired.
