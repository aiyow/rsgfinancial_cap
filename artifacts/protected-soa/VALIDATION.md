# Protected SOA implementation validation

Validated with synthetic data only; no real resident emails or statements were used.

- Backend unit suite: 219 passing, including actual qpdf encryption checks (no skipped tests).
- Protected export HTTP integration: 9 passing in a disposable PostgreSQL schema. Actual PDFKit/qpdf rendering was enabled; the intercepted emailed password opened the returned PDF.
- Existing SOA date-correction integration: 6 passing with the protected-export suite (19 combined checks passed).
- New browser download flow and existing glass viewer privacy tests: desktop 1366px, mobile 390px and 320px passed.
- Targeted ESLint and production frontend build passed. Existing build chunk-size advisory remains.
- Docker linux/amd64 image builds. Network-disabled, non-root (UID 1000) smoke test passed with actual AES-256 R6 encryption and a required opening password. Private `.env` and local tools are excluded.
- PDFs reject missing/wrong passwords and accept the random opening password. Printing is allowed. Failed encryption removes its private plaintext input; abandoned application-owned directories are cleaned.
- PDF visual and text checks covered logo, colors, invoice references, amounts, dates, Filipino Unicode names, long names and 100 invoice references across pages. Preview documents contain synthetic amounts only.

Activation update, October 27, 2026: migration 043 was applied to the configured Neon database. The configured SMTP service passed TLS/authentication verification without sending email. At the user's explicit request, local protected exports were enabled and qpdf configured, and the development backend was reloaded. The Render blueprint export flag was also enabled for the next deployment; existing SMTP port/TLS settings are preserved. Actual Render deployment and provider/viewer staging checks remain separate. No hosting purchase or deployment was performed.
