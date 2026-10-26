# Detailed Activity Log

The Admin Activity Log records saved business changes initiated by identified Admin, Billing Associate and Resident users. Automatic system changes are excluded from recording, search, list/detail access and totals. Previously stored system/unknown-actor entries are retained in the database. Each entry identifies the actor and affected record and can be expanded to show safe before/after values, reasons, counts, and affected units. Dates and times use Asia/Manila.

## Storage and rollout

Apply migration 042 with `npm run audit:migrate` from `backend/` before releasing the backend and frontend. The migration adds `audit_logs.context` JSON and a timestamp/ID timeline index. The migration runner verifies that every existing audit field is preserved and rolls back if the verification fails. It is safe to rerun; fresh initialization also discovers migration 042.

Context version 1 stores an origin (`USER` or `SYSTEM`), an identifying `target`, optional `counts`, and grouped `affectedRecords`. Each affected record can contain `before` and `after`; null means absent, while a missing value means it was not recorded. Bulk operations create one business entry, rather than one feed entry for every unit. Each affected-unit page contains up to 25 records.

Actor snapshots take precedence over the current account name/role. Deleting or renaming an actor does not rewrite history. Independent automatic penalty and delivery outcomes are maintained in their business tables but are no longer added to Activity Log. Historical entries with no recoverable user role are excluded from the user activity view. Old OR references in historical records stay as originally recorded; current approved transactions use REF references.

Old entries are rendered from their original snapshots, including deleted batches whose coverage and counts were already captured. Uncaptured details cannot be recreated and are shown as Not recorded. Audit entries cannot be edited, cleared, or deleted through the application. There is no automatic retention cleanup.

## Coverage and atomicity

`backend/services/auditCoverage.js` declares every mutation endpoint as recorded or excluded. Its test fails when a new mutation route is introduced without declaring coverage. Declaring a route is not sufficient: new business writes must use the shared writer and add an integration test for its snapshot and rollback behavior.

Recorded operations include accounts/approvals, registration and actual email verification, profile/email/password changes, units/assignments, drafts and draft edits, reading imports/corrections, SOA generation/reopening/forwarding/publication/deletion, payment submission/review/manual entry/invoices/deletion, analytics imports/replacements/deletion/clearing, explicit forecast refreshes, recommendation state/deletion, and template/logo/QR changes. Assignment-driven occupancy changes are grouped in the assignment entry. Reading/import entries identify regenerated forecasts/recommendations. User-requested email retries/resends are recorded when queued. Automatic delivery/reminder outcomes are not Activity Log events.

Excluded operations are sign-ins, rejected/failed business requests, ordinary views/downloads, notification read markers, temporary OTP/email challenges, previews, and browser-only preferences. Existing explicit recommendation acknowledgement changes remain audited. Technical timestamps alone do not create update entries; credential changes are recorded as flags without credential values.

Database mutations and their audits use the same transaction. Audit failures roll back business writes. A new logo/QR upload is removed if the transaction fails, while the old asset is only removed after commit. Email cannot be recalled after SMTP accepts it: resulting delivery states are saved together in their business transaction, and a persistence failure leaves the existing retry workflow available. No credentials or raw provider failure messages are copied into delivery audits.

The shared writer and API recursively exclude passwords, hashes, OTPs, tokens, Cloudinary/storage identifiers, private asset links, receipt paths, workbook/file bytes, and raw OCR text. Admins may see the safe payment fields, including transaction REF and OCR/verified receipt references as separate fields. Never pass whole requests or unfiltered file objects to the writer.

## API

- `GET /api/audit-logs`: Admin only. Accepts `page` (default 1), `pageSize` (10/25/50; default 10), `q` (up to 200 characters), `entity`, `action`, `actorRole`, optional `actorId`, and inclusive `from`/`to` calendar dates. Delete aliases include both DELETE and DELETED; SUBMIT includes legacy resident reports stored as CREATE.
- The response contains lightweight `logs`, `pagination` (`page`, `pageSize`, `pageCount`, `total`), filtered user-role `summary` (Admin, Billing Associate and Resident only), and global entity/action `filters`. Heavy snapshots/affected arrays are omitted from list responses. Order is created_at descending then ID descending. Pages are bounded to the last available page.
- `GET /api/audit-logs/:id`: Admin only, returning `{log}` with sanitized `oldValues`, `newValues`, context and affected records. Returns 404 for missing entries. Both endpoints use no-store caching.

Search uses business identifiers rather than raw legacy snapshot JSON. Date filters use Manila midnight boundaries. The user activity feed has no 200-entry cap. Advanced filters start collapsed behind a Show/Hide filters button; search stays visible and filter values survive hiding. Compact metrics and activity rows reduce vertical space. Pagination retains feed height while fetching and its controls have no hover/active movement. Expansion loads details on demand, caches successful results while the row is mounted, and offers an inline retry on failure.

## Verification

- Backend: `npm run test:audit`; existing account, import, payment, SOA correction, bulk-unpublish and assignment integration tests.
- Frontend: `node --test test/auditLogPresentation.test.mjs`, targeted ESLint and `npm run build`.
- Browser: `node test/browser/auditLogs.mjs` with Playwright available and Vite on port 5173. It uses mocked GET requests only and captures mobile/desktop previews in `artifacts/detailed-audit/`.
- Audit API tests use a disposable private schema. They cover over 200 records, user-role snapshots after rename/deletion, exclusion of automatic/unknown entries, legacy details, redaction, combined filters, Manila date boundaries, access controls, no-op edits and rollback of unit/draft changes when auditing fails.
