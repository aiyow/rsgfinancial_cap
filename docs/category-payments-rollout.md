# Category payment ledger (migration 033)

One SOA retains two independently reconciled charge rows. Tenants may submit water proofs only; owners may choose water, association dues, or combined. Staff invoice numbers are optional and category-specific, never inferred from transaction references. Admin alone creates manual payments and approves proofs; Admin and Billing Associate may edit issued invoices on approved payments.

## Clean-start safety

No legacy payment data is deleted or assigned a guessed category. From `backend`:

1. `npm run payments:preflight` — read-only counts and affected record IDs for submissions, applications, advances and bill-level invoice references.
2. Stop activation if any legacy activity remains. Approved-payment cleanup requires a separately scoped backup and cleanup; this release does not provide it.
3. `node scripts/paymentMigration.js --check` — validates migration 033 inside a rolled-back transaction.
4. `npm run payments:regression` — opt-in current-database tests, all fixtures and migration DDL rolled back. Use during a maintenance window; tests briefly lock an existing unit. Sequence IDs may advance despite rollback, which is normal PostgreSQL behavior.
5. Release the revised backend and frontend together with `node scripts/paymentMigration.js --activate`. The migration uses a direct connection, rechecks the clean-start condition under locks, retains SOAs/readings/assignments and audits the association-only penalty transition. Local nodemon/Vite reload the source; hosted environments require a coordinated deployment.
6. Confirm `payments:preflight` reports policy version 2 active and no test submissions/applications retained. Do not run the old backend against the new policy.

The original isolated-copy recommendation was superseded by the user's explicit request to test the current branch after deleting legacy payments. No additional branch is required by these scripts. Do not delete any previously created test branch as part of rollout.

## Allocation and corrections

- Work in centavos. Category allocations sum exactly to verified cash; applications cannot exceed category budgets or charge balances.
- Combined payments cover association principal and association penalty before water. Combined excess remains association advance; category-only excess remains in its category.
- Approval affects the selected SOA only. Existing credits are not silently swept into that approval or older SOAs. Future generation applies available category credits chronologically.
- Unit locks serialize approval, generation credit application, penalty recalculation and corrections. Payment, applications, audit and notifications commit together.
- The configured penalty rate applies once to association principal unpaid at the due date; water never receives a penalty. A late-approved pre-due proof recalculates the penalty with an audit entry.
- Corrections rebuild applications on that SOA only. Payment budgets, purpose and invoice references survive; released cash becomes advance in its original category.
- Multiple partial payments retain individual invoices. An invoice number may be shared across both allocations of a combined payment. The old ambiguous bill-level invoice write is rejected; the general note remains editable.

## API additions

- Receipt preview/submission and manual payment require `paymentPurpose` (`WATER`, `ASSOCIATION_DUES`, `COMBINED`). OCR only extracts receipt facts.
- `POST /api/payments/allocation-preview`: Admin-only, read-only allocation preview using verified amount/date and selected SOA. Save/approval rechecks balances under lock.
- `PATCH /api/payments/:id/invoice-references`: `{ "invoices": [{ "chargeType": "WATER", "invoiceNumber": "W-123" }] }`. Include either/both allocated categories; blank/null clears that category invoice.
- SOAs include `chargePayments` for each category (original charge, penalty, approved/applied amount, remaining balance, pending proof, advance, invoice references and payment IDs).
- Resident SOAs additionally include `allowedPaymentPurposes`, `payableBalance`, `payableApprovedAmount`, `payablePaymentStatus` and `hasPayablePendingPayment`. Overall SOA balance/status retain their meaning.

## Verification

Backend: `npm test`, `npm run payments:regression`. Database fixtures cover acceptance, combined priority, separate/shared invoices, partial payments, designated advances, future application, selected-SOA isolation, penalties/backdating, zero charges, corrections, pending/rejected proofs, duplicate references, deferred DB constraints, exact reports, real API permissions, rollback on notification failure and competing unit locks.

Frontend: `npm test`, relevant `npx eslint` checks, `npm run build`. Mobile fixture checks at 375/400px cover compact Bills, tenant water balance/owner association balance, disabled settled-water submission and full SOA fit/zoom. Existing shared print CSS removes viewer scaling; no new receipt/PDF generator is introduced. Temporary UI fixtures must not be shipped.

Acceptance: association ₱1,608.84 + water ₱58.90; approve water ₱58.90 → water balance ₱0.00, association ₱1,608.84, overall `PARTIAL`, invoice only on water. Forecasting remains unchanged.
