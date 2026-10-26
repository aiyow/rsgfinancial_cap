# Unique payment reference numbers

Every approved payment transaction has one system-generated **Reference number**, such as `REF-0000174`. Migration 041 replaces the former `OR-0000000174` format with `REF-` followed by the full transaction ID padded to at least seven digits. Combined water/association payments share one reference number; category allocations and invoice numbers remain separate. Bank/GCash transaction references remain separate from this system-issued identifier.

PostgreSQL generates and stores the number, prevents direct editing, and enforces uniqueness with `payment_submissions_official_receipt_unique`. Pending/rejected proofs have no issued number; uploaded proofs receive one when approved, and manual payments receive one when recorded as approved. The full transaction ID is retained beyond seven digits, and gaps are expected because unapproved submissions also use IDs. Failed approvals roll back the number and allocations together. Changing an invoice does not change the reference number.

The **Reference number** label is used in Admin/Billing Associate payment queues and details and resident payment history. Search matches it. The existing API property `officialReceiptNo` and generated database column `official_receipt_no` are retained for compatibility. Historical audit entries retain their original identifiers; current payment records use the new REF format. The OCR and verified receipt reference fields, amounts and allocations are preserved.

## Database setup and validation

Run `npm run payments:migrate-receipts` from `backend/` to apply migrations **040** and **041**. Its transaction verifies that all payment fields except the generated identifier stay unchanged, identifiers match the REF format, and all approved identifiers are distinct. Failure rolls back the migration. The command can be rerun safely. Fresh database initialization also discovers migration 041 automatically.

`npm run test:payment-receipts` tests conversion from existing OR values, preservation of receipt references, historical approvals, combined allocations, concurrent manual payments, role access, immutable generated values, repeated approval, rollback and large IDs using a disposable private schema. It creates no real payments and never approves or rejects real submissions. The REF views/search are checked with mocked APIs in `frontend/test/browser/paymentOfficialReceipts.mjs`.

## Receipt zoom and navigation

Payment Verification uses a sized image canvas inside a two-axis scroll viewport. Image dimensions grow with zoom; its top/left never extend into negative scroll space. The receipt fits at 100%, with zoom controls from 75% to 250% and reset-to-fit. Zoom preserves the visible center. Controls remain outside the scroller.

Mouse dragging, scrollbars, keyboard arrows and mobile swipes move around the zoomed image. The payment columns contain overflow so the image cannot widen the entire page. Download and share continue to use the original receipt file.

`frontend/test/browser/receiptViewer.mjs` uses fabricated PNGs and mocked read-only APIs to check all four image edges, tall receipts, mouse dragging in every direction, keyboard scrolling, zoom limits, reset, download, mobile two-axis touch gestures and page-width containment. No actual payment records or uploaded receipts are changed.
