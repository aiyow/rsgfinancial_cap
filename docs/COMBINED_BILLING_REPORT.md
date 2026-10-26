# Overall Billing report

Admin and Billing Associates can open **Financial Reports → Overall Billing**, select a month or date range, and choose **View Report**. The table includes every directory unit, including fully paid units and units without a selected SOA. Excel and Print / Save PDF export the full table rather than only the visible scroll area.

## Selection and calculations

- Select live SOAs by their saved billing-period **start date**, inclusively between the selected start and end dates. Generated, forwarded and closed batches are included even when unpublished; draft and analytics-history batches are excluded.
- Calculate each SOA's association dues, water and applicable penalties with the existing report calculations. Round charge lines in PostgreSQL and aggregate the combined report in integer centavos.
- Count approved ledger applications against those selected SOAs when the verified payment date is on or before the selected end date. A payment before the selected start date can settle a selected SOA; a later payment cannot. For example, a November-dated payment does not settle the October report.
- Pending/rejected proofs, unapplied advance credits and payments applied to earlier-period bills are excluded. An advance counts once it is applied to a selected SOA, subject to the same payment-date cutoff.
- Cap paid amounts at each SOA's billed amount before summing by unit. Surplus on one bill cannot settle another bill in this report. Remaining balances are never negative.
- Use distinct payer names saved on the selected SOAs, joined when the selection includes different payers. Units with no selected SOA use the current directory's resident names.

Statuses are **Paid**, **Partially Paid**, **Unpaid**, **No Charges** (selected SOA with zero charges), and **No SOA**. The summary and grand-total row sum the same unit rows. Unit numbers use natural sorting.

This is selected-period billing with a payment cutoff, rather than a cumulative statement of all previous outstanding bills. Existing report tabs retain their own selection rules. Accounts Receivable includes all still-unpaid bills through the selected end date, including earlier months; its screen, print and Excel headings state that cutoff. Unit-based report rows are sorted naturally by unit, then billing period (oldest first within each unit).

## API and exports

`GET /api/reports/financial` adds `combined: { asOfDate, rows, totals }` without changing existing sections. Every report/export read uses a read-only repeatable-read transaction so billing, payments and directory rows share one database snapshot. Existing penalty maintenance runs before that snapshot.

`GET /api/reports/financial/export?month=2026-10&tab=combined` returns one Excel worksheet containing the period, cutoff, notes, summary, complete table and grand totals. Amount cells are numeric with peso formatting. Existing export identifiers, including `paidDues`, remain supported; matching is case-insensitive.

Print / Save PDF contains only the title, reporting period, complete table and a single grand total. Summary cards and explanatory notes are omitted. It uses A4 landscape, regular Arial text, black borders, white backgrounds, repeating column headers and rows kept together. The screen table scrolls within its panel on small displays. Billing-selection and cutoff explanations appear in Excel; the screen shows the table directly below its heading. Export actions are disabled during report refreshes and after a failed refresh until a new report succeeds.

No database migration is required.

## Validation

```powershell
# backend/
npm test
npm run test:combined-report
# frontend/
npm test
npm run build
npx eslint src/components/CombinedBillingReport.jsx src/pages/shared/FinancialReportsPage.jsx
```

The combined integration test creates a disposable private PostgreSQL schema on a direct connection, tests all statuses, payer snapshots, multiple bills, date ranges, centavos, payment cutoffs, combined payments, unpublished bills, authorization, every export tab, concurrent payment approval and rollback. It drops the schema afterward. It does not change public billing/payment records or send email.

The integration test writes fabricated fixtures and an exported workbook under `artifacts/combined-report/`. With Vite running, the browser checks use only mocked API responses:

```powershell
# repository root; set PLAYWRIGHT_MODULE to an available Playwright module if needed
node frontend/test/browser/combinedFinancialReport.mjs
```

Browser validation covers Admin/Billing Associate access, 143 rows, download/print, stale-export prevention, retry and mobile scrolling. The generated 143-unit PDF was checked across seven landscape pages, with repeating headers and exactly one grand total; first, middle and final pages were visually reviewed.
