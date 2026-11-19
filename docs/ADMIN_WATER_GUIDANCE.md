# Admin water guidance

The Admin dashboard shows **Recommended admin actions** below its historical/projected water-charge graph. Guidance is read-only and scoped to water: consumption trend, inspection priorities, and forecast coverage. Billing Associate and resident dashboards are unchanged.

The Water Analytics page shows historical and projected consumption and charges in two charts. The **Prescriptive Recommendations** section below the charts contains the prioritized per-unit action queue.

## Calculation and API

`GET /api/analytics/overview` adds `adminWaterGuidance` only for Admin. The guidance contains `status`, `sourcePeriod`, `sourceMonth`, `forecastMonth`, `coverage`, `comparison`, `inspections`, and up to three dashboard `recommendations` (key, priority, title, condition, action). The API also returns `chartInsights.consumption` and `chartInsights.bill` for compatibility with earlier clients.

The source is the latest eligible period containing readings, ordered by period start and ID. Eligibility uses the existing shared visibility rule: forwarded/closed live billing or a visible historical import. Forecasts must belong to that exact period and target its following calendar month. Old forecasts are not used when the latest period has no forecasts. Unit identities, forecasts, and monthly history are deduplicated deterministically; source-period readings take precedence in their month, and future history is excluded.

Only units with nonnegative numeric READY predictions and valid nonnegative actual consumption in the exact source period enter the trend comparison. Missing values are not zero. Actual and projected consumption use the same units; charges for both use the source period's positive water rate. Invalid/missing rates omit charge estimates. The graph still shows its existing totals, so the UI explains that its unit coverage may differ from the comparable subset.

Consumption changes of at least +15% classify as INCREASE; at most -15% as DECREASE; smaller changes as STABLE. Zero baselines and unavailable comparisons omit percentage claims. No source produces NO_DATA; no comparable units produces NO_COMPARISON. A zero baseline still preserves comparable volumes and charges.

Inspection counts reuse the existing pure unit recommendation rules for high projected usage, vacant-unit usage, and flagged readings. Counts per category may overlap, but the total counts distinct units. Payment reminders and routine monitoring are excluded. Missing current readings do not cause vacant-unit diagnoses from stale history. Inspections remain visible when the aggregate trend decreases. Historical-only sources work without creating persisted recommendations.

Coverage reports all current units, ready forecasts, comparable units, and excluded reasons. Guidance explicitly labels partial coverage. Resident charges are not represented as supplier expense, confirmed leaks, or guaranteed savings.

Water-charge insights calculate the peso difference from the rounded comparable charge totals. They use that difference even when the consumption movement is below the 15% threshold, and omit percentage claims when the baseline is zero. An invalid/zero rate produces a billing-rate correction action rather than a false zero-charge projection. A valid source rate is never assumed to be the approved rate for the next billing period; the billing action asks staff to verify it. Bill recommendations contain no vacant-unit or leak-inspection instructions. Missing inputs generate different consumption-history and billing-input actions.

## UI and operation

The section is rendered inside the water chart card for Admin only. The heading and source/forecast months remain visible; comparable totals, evidence, actions, and the link to `/admin/analytics` start collapsed. An accessible Show details / Hide details button expands or collapses them, with Enter/Space support and `aria-expanded`/`aria-controls`. The chart's historical range selector does not change the recommendation period. Existing dashboard refresh/cache behavior applies; no new notifications, stored recommendation rows, audit entries, or schema migration are introduced.

Manual edits: calculations and data loading are in `backend/services/analytics.js`; presentation is in `frontend/src/components/AdminWaterGuidance.jsx`, composed by `OperationalDashboard.jsx`.

## Verification

Backend: `node --test test/adminWaterGuidance.test.js test/integration/adminWaterGuidanceHttp.test.js test/prescriptiveAnalytics.test.js test/predictiveAnalytics.test.js test/refreshAnalyticsForecasts.test.js` from `backend/`. API tests use temporary tables and roll back fixture changes.

Browser: `node test/browser/adminWaterGuidance.mjs` from `frontend/` with the dev server on `http://127.0.0.1:5173`. Set `PLAYWRIGHT_MODULE` to an available Playwright module when it is not installed locally. APIs are mocked and permit GET only; tests cover desktop, 390px/320px mobile, fixed guidance across chart ranges, empty data, missing forecasts, zero baselines, and Collector exclusion. Screenshots are saved under `artifacts/admin-water-guidance/`.
