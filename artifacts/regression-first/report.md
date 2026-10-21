# Regression-first forecasting activation

Linear Regression is now the active default. Stable Recent Months activates only for a qualifying spike or unexpected zero in the latest three valid consecutive readings, using five prior valid months to test each event. It expires when the last qualifying event leaves that window. Real readings are retained.

The former `stable`, `legacy`, and `revised` policies remain available. No migration or endpoint change was needed. Staff see the selection explanation alongside the model; unavailable results display **No forecast**.

## Historical comparison

Both policies used the same 551 eligible unit/month pairs, including real zeros and spikes. No case was excluded because of its forecast error. Eligibility matched in every case. The JSON report lists each pair and monthly exclusion counts; the newest unobserved target month is not scored.

| Metric | Former stable policy | Regression first |
| --- | ---: | ---: |
| MAE (m3) | 2.293 | 2.494 |
| RMSE (m3) | 4.299 | 4.553 |
| WAPE | 39.73% | 43.20% |
| Historical regression forecasts | 279 | 485 |
| Historical stable forecasts | 272 | 66 |

This is an honest accuracy tradeoff: historical error increased. Activation follows the explicit decision to keep regression primary; it is not a claim of improved accuracy.

Latest source period: **September 5, 2026**, forecasting **October 2026**.

| Latest outcome | Former stable policy | Regression first |
| --- | ---: | ---: |
| Linear Regression | 1 | 104 |
| Stable Recent Months | 138 | 35 |
| No forecast | 3 | 3 |

## Activation and checks

- Passed 109 backend tests and 31 frontend tests, the frontend production build, focused frontend lint, and whitespace checks.
- Tested normal fluctuations, exact trends, spike boundaries, unexpected and recurring zeros, all-zero histories, baseline sufficiency, expiry, multiple events, numeric strings, gaps, flagged values, rounding, persistence, and future-data leakage. Existing usage-review tests still pass.
- Regenerated and checked all 1,278 saved forecasts across nine source periods, then regenerated recommendations through the existing atomic refresh workflow. Before commit, every saved model, prediction, charge, reason, status, and sample count matched the new policy.
- Row counts and whole-row hashes for billing periods, meter readings (including validation flags), billing statements, payment submissions, payment applications, payment charge allocations, and units were identical before and after refresh.
- Read-only API checks verified staff, per-unit and resident forecasts. All 337 active recommendations link to refreshed forecasts.
- Browser checks verified admin and collector model explanations, **No forecast** labels, mobile resize bounds, and resident estimates for both forecasting models, with no browser errors. A ready forecast's explanatory reason does not become a resident warning.

Evidence: `comparison.json`, `activation.json`, `display-verification.json`, and staff/resident screenshots in this directory.

Repeat the read-only comparison from `backend` using `npm run forecasts:compare-policies`. The activation harness requires an explicit `--activate` flag and should be used only when a rebuild is intended.
