# Draft billing validation

Creating or editing a live billing draft requires:

- Water and association-dues rates of at least 0.01. Rates use two decimal places in the database, so smaller values could otherwise round down to zero.
- Real dates, with period end strictly after period start.
- Coverage of at least one and at most two calendar months, including both boundaries.
- A due date strictly after period end, and no later than one calendar month after it.
- Late penalty from 0 to 100 percent; zero remains allowed.

Calendar-month arithmetic keeps the original day when possible and clamps to the destination month's last day. January 31 to February 28, 2026 is one month; in leap year 2028 the equivalent end is February 29. January 31 to March 31 is two months. If coverage ends January 31, the due date may be February 1 through February 28 (February 29 in a leap year).

The browser provides date-picker bounds and inline field errors. The API independently validates all requests. Partial draft edits are checked against the merged saved settings inside a transaction with a row lock, preventing concurrent edits from combining into invalid dates.

The independent browser and API policy modules must stay identical. This policy applies to draft creation and edits; it does not rewrite existing billing periods, historical analytics imports, or the separate Admin SOA correction workflow. No database migration is required.

Validation:

- `node --test test/billingPeriodPolicy.test.js test/integration/billingPeriodValidationHttp.test.js` from `backend/`. API tests use a disposable database schema.
- `node test/browser/billingPeriodValidation.mjs` from `frontend/`, with Playwright available and Vite on port 5173. All API responses are mocked.
