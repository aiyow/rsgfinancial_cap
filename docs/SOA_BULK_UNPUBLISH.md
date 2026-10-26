# Password-protected Unpublish All

In Admin → Forward Billings → a forwarded batch, **Unpublish All** appears when every SOA in that batch is published and the batch contains at least one SOA. Search, filters and pagination do not change the scope: the confirmation always covers the whole batch.

The dialog shows the SOA count and requires the signed-in Admin's current password. Empty passwords disable confirmation. Wrong passwords and stale-batch errors appear inside the dialog, clear the password field and allow another attempt. Cancel/Escape clears the dialog state. While the request runs, confirmation and dismissal are disabled. Passwords stay in component memory and the request body; they are never saved in browser storage, URLs or audit logs.

## API and transaction

`POST /api/billing-periods/:id/unpublish` accepts `{ "currentPassword": "..." }` and is Admin-only. The current password is checked on the server against the acting Admin's saved hash, including existing legacy hashes. The acting account must still be active, approved and an Admin.

The transaction locks the actor, billing period, affected units in ascending order and SOAs. It rechecks that the period is live billing with FORWARDED/CLOSED status and every SOA is still published. Empty/partially published batches return HTTP 409; unknown/history periods return 404; incorrect passwords return 403. Invalid bodies return 400. Simultaneous confirmations serialize; a later request sees the changed batch and makes no additional changes.

On success, all affected `published_at` and `published_by` values are cleared, their SOA publication notifications and email delivery records are removed, and one batch audit entry records the actor, previous publication values and affected IDs/count. Already sent or in-flight emails cannot be recalled. Any failure, including audit failure, rolls back the entire transaction.

Bills, charges, meter readings, validation flags, payments, allocations and batch status are preserved. The existing publication actions can publish the hidden SOAs again. No database migration is needed.

## Validation

- `backend/`: `npm run test:soa-unpublish` uses a disposable private PostgreSQL schema on direct connections. It tests 143 SOAs, authorization, password validation, another Admin's password, partial/empty/draft/history batches, stale dialogs, rollback, simultaneous confirmations, closed batches and legacy hashes. It verifies financial records remain identical and drops all fixture records afterward. It never sends real email.
- Repository root with Vite running: `node frontend/test/browser/bulkUnpublish.mjs` (set `PLAYWRIGHT_MODULE` if needed). Every API response is mocked. Checks include filtered whole-batch scope, empty/wrong password, stale state, cancellation, disabled controls while submitting, refreshed counts, hidden button for partial batches, desktop/mobile layout and Escape/focus/scroll cleanup.
- `frontend/`: build and focused ESLint checks for `AdminSoaBatchPage.jsx` and `UnpublishBatchModal.jsx`.

Real published SOAs are not unpublished during validation.
