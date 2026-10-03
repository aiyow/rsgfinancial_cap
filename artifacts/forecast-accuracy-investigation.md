# September forecast accuracy investigation

Connected data captured 2026-10-03T15:56:05.609Z. January–August historical imports and September live billing (period starts September 5) are included. Database capture was read-only.

## Cause of the score drop

August: 782.458 m³ actual consumption and 349.259 m³ absolute forecast error. September: 711.708 m³ and 384.534 m³. Actual consumption fell 9.04%; absolute error rose 10.10%.

Restricting September to the 138 units also evaluated in August gives 54.02% WAPE, versus 54.03% across all 139 units. Coverage changes explain very little of the score drop.

| Unit | September forecast (m³) | Actual (m³) | Absolute error (m³) |
| --- | ---: | ---: | ---: |
| 503 | 0.000 | 40.052 | 40.052 |
| 235 | 44.787 | 7.522 | 37.265 |
| 437 | 6.750 | 27.214 | 20.464 |
| 231 | 22.758 | 3.884 | 18.874 |
| 307 | 15.087 | 0.000 | 15.087 |

Unit 503 used below 1.35 m³ in each earlier month, then 40.052 m³ in September. Units 307 and 306 went from regular positive use to zero. These changes warrant checking readings and occupancy, but remain valid observations in the evaluation; no reading was changed or removed.

## Policy comparison

All rows below use the same 551 eligible unit/month pairs, with chronological cutoffs. Predictions for September use only readings through August. All results are retrospective development comparisons on this dataset, not independent future validation.

| Policy | MAE (m³) | RMSE (m³) | WAPE error | Derived accuracy |
| --- | ---: | ---: | ---: | ---: |
| Saved current policy | 2.455 | 4.670 | 44.16% | 55.84% |
| New stable policy | 2.339 | 4.168 | 42.08% | 57.92% |
| Last-month baseline | 2.279 | 4.344 | 41.00% | 59.00% |
| Three-month-average baseline | 2.256 | 4.343 | 40.58% | 59.42% |

Acceptance gate: **passed**, using unrounded scores. Lower aggregate MAE and WAPE without increasing RMSE on identical saved forecast/actual pairs.

| Month | Evaluated / excluded | Saved accuracy | New accuracy | Saved RMSE (m³) | New RMSE (m³) |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2026-06 | 137 / 5 | 58.97% | 58.97% | 3.839 | 3.839 |
| 2026-07 | 137 / 5 | 62.16% | 62.16% | 3.173 | 3.173 |
| 2026-08 | 138 / 4 | 55.36% | 61.87% | 4.946 | 3.892 |
| 2026-09 | 139 / 3 | 45.97% | 47.77% | 6.142 | 5.421 |

The stable policy retains five consecutive valid readings, the twelve-month maximum, and full-window regression until two earlier comparison months exist. After that, irregular usage blends last-month consumption, recent-three-month average, and recent-five-month median equally. Exact linear trends still use regression. Legacy and adaptive policies remain available in code. Real zero readings, missing values, flagged readings, and month gaps keep their existing treatment.

An ungated blend also performed better in aggregate, but would change the established five/six-reading regression fallback. It was not promoted. A candidate-selection guard improved aggregate scores only slightly and worsened September, so it was not promoted either. The JSON records all tested variants.

## Corrections and visibility

The benchmark now matches actuals by calendar month, so a live period starting on the fifth is included. Dashboard evaluation now includes same-pair actual/error totals and the five largest unit errors with shares of total error. Stored historical forecasts can be rebuilt through the existing transactional refresh, producing retrospective scores and updating dependent recommendations. Actual bills and meter readings are unaffected.

Reproduce from backend: `node scripts/benchmarkForecasts.js --updated`, then `node scripts/investigateForecastAccuracy.js`. Capturing again replaces the connected snapshot; preserve this run before a live forecast refresh if comparing against these original saved predictions.

## Applied refresh and verification

The benchmark passed and the existing transactional refresh completed for all nine eligible periods, including dependent recommendations. A subsequent read-only overview check confirmed September accuracy 47.77%, WAPE 52.23%, MAE 2.674 m³, RMSE 5.421 m³, and evaluated/excluded counts 139/3. October coverage remains 139 ready and 3 excluded out of 142 units. Actual bills and meter readings were not modified.

All 72 backend tests passed, including the stable policy, future-reading cutoff, mixed/history-only refresh and rollback, live September start dates, valid-zero evaluation, and error attribution. The analytics-page lint check and frontend production build passed. The build retains its existing large-chunk warning.
