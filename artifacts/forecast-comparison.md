# Forecast implementation and January–September comparison

Verified October 3, 2026. All results below are retrospective, chronological one-month-ahead evaluations, not a guarantee about future accuracy.

## Updated Excel history

Re-read all nine files in `ml/excel predictive data`: January through September, each with 142 unit readings. The filenames contain no year; the benchmark retains the application's 2026 interpretation. Consumption is calculated from raw present minus previous readings, not the workbook's cached consumption cells.

Training and model selection never include the evaluated month. June uses January–May; July uses January–June; August uses January–July; September uses January–August. Adaptive selection requires two earlier validation months, so forecasts with five or six training readings retain full-window regression.

### Aggregate errors, identical 551 eligible unit/month pairs

| Policy | MAE (m³) | RMSE (m³) | WAPE error | Derived accuracy |
| --- | ---: | ---: | ---: | ---: |
| Legacy policy rerun on numeric workbook readings | 2.483 | 4.746 | 44.67% | 55.33% |
| Revised adaptive policy | 2.455 | 4.670 | 44.16% | 55.84% |
| Last-month baseline | 2.279 | 4.344 | 41.00% | 59.00% |
| Three-month-average baseline | 2.256 | 4.343 | 40.58% | 59.42% |

The revised policy passes the requested promotion gate: lower aggregate MAE and WAPE, with no increase in RMSE. The gate uses unrounded metrics. Improvement is modest; the simple baselines remain stronger overall. Do not describe the adaptive method as universally best. More future actual readings are needed to test generalization.

### Monthly results

| Evaluated month | Evaluated / excluded | Legacy WAPE | Revised WAPE | Revised MAE (m³) | Revised RMSE (m³) |
| --- | ---: | ---: | ---: | ---: | ---: |
| June 2026 | 137 / 5 | 41.03% | 41.03% | 2.372 | 3.839 |
| July 2026 | 137 / 5 | 33.23% | 37.84% | 2.145 | 3.173 |
| August 2026 | 138 / 4 | 46.99% | 44.64% | 2.531 | 4.946 |
| September 2026 | 139 / 3 | 58.64% | 54.03% | 2.766 | 6.142 |

Latest-month derived accuracy improves from 41.36% to 45.97%. July worsens despite the aggregate improvement. September's last-month baseline has WAPE 52.73% and RMSE 5.641 m³, while the three-month-average baseline has WAPE 56.05% and RMSE 5.815 m³.

The workbook dataset can produce October forecasts for 139 units; 3 remain excluded because their post-flag continuous histories are too short. These October predictions are not evaluated because no October actual readings are available.

### Data quality

September contains 28 cached-value mismatches across 14 units: consumption does not equal present minus previous, and the corresponding water charge does not equal calculated consumption times rate. This may reflect stale formulas or incorrect cached values. No workbook was edited or saved. Exact cell addresses, cached values, and expected values are recorded in `forecast-workbook-benchmark.json` under `formulaIssues`.

Six meter-validation flags occur across the nine months (units 414, 407, 405, 521, 413, and 538). Flagged readings and gaps break the training sequence; older valid readings are never bridged across a break.

Largest cumulative legacy-error contributors across June–September are units 235 (102.997 m³), 231 (49.475 m³), 336 (44.376 m³), 503 (40.757 m³), and 438 (35.424 m³). Revised totals are 99.691, 47.296, 38.988, 40.757, and 27.174 m³ respectively. Full pair-level predictions, selected models, exclusions, and the top-ten contributor list are retained in the JSON report.

## Connected database evidence

The read-only capture found January–August, not September. January–August workbook consumption matches the connected readings; September has 142 workbook readings absent from the connected database. No import or live forecast refresh was performed.

The original connected-algorithm capture was preserved before implementation in `forecast-dataset.json`, including saved forecasts and recomputed original predictions. On the same 412 eligible June–August pairs:

| Metric | Captured original algorithm | Revised algorithm |
| --- | ---: | ---: |
| MAE (m³) | 2.448 | 2.350 |
| RMSE (m³) | 4.288 | 4.055 |
| WAPE error | 42.91% | 41.18% |
| Derived accuracy | 57.09% | 58.82% |

This independently passes the promotion gate. The numeric workbook legacy rerun is not the original connected snapshot: it also normalizes numeric input, whereas the original average calculation could concatenate PostgreSQL numeric strings. Keep these evidence sets distinct.

Read-only integration checks passed for overview, resident, and unit analytics queries. The connected dashboard still holds the original August score of 50.17% and September forecast coverage of 139/142 until a refresh is requested. Its August score should become 55.36% under the revised policy on the captured data. Import September through the normal UI to make October the next forecast month, then refresh if necessary.

## Delivered behavior

- Five-month minimum, twelve-month maximum; six candidate methods with chronological MAE selection and deterministic tie-breaking.
- Exponentially weighted regression with a three-month half-life; real zeros preserved and negative predictions clamped to zero.
- Shared period eligibility: visible historical imports and forwarded/closed live billing.
- Missing source-month readings cannot generate stale next-month forecasts. Null, blank, boolean, and nonfinite numeric inputs are missing, not zero.
- Refresh rebuilds every eligible period chronologically and recommendations afterward, in one transaction with rollback on failure; history-only installations are supported.
- Overview retains existing fields and adds monthly `evaluationHistory` with model and baseline metrics on identical pairs.
- Quality UI shows WAPE, derived accuracy, monthly comparisons, coverage, and retrospective labeling. WAPE and derived accuracy are unavailable when aggregate actual consumption is zero. Accuracy is `max(0, 100 − WAPE)`, not a probability.
- Solid historical lines and dashed future-only continuation are preserved. No schema migration or forecasting dependency was added.

## Verification and reproduction

Backend tests: 68 passed, covering trends, spikes, steady use, sustained changes, real zeros, numeric strings, missing values/months, flags, insufficient history, source cutoff/no leakage, refresh ordering, rollback, and recommendations. Frontend production build passed; targeted analytics-page lint passed. Full frontend lint remains blocked by seven errors in unrelated pages. The build also retains its large-chunk warning.

From `backend`:

```text
npm test
npm run forecasts:capture
npm run forecasts:benchmark
npm run forecasts:verify-reads
python scripts/readForecastWorkbooks.py
npm run forecasts:benchmark-workbooks
```

Use the installed/bundled Python executable if `python` is unavailable. `forecasts:capture` intentionally replaces the local capture artifact, so preserve the original evidence first if benchmarking subsequent changes. `node scripts/benchmarkForecasts.js --updated` writes `forecast-connected-dataset.json` without replacing the original capture. Read-only capture and verification never mutate the database. Workbook comparison requires the connected snapshot and extracted workbook source artifacts.

Restart the backend to load the changed policy. The normal **Refresh forecasts** UI action is the explicitly confirmed write path; it updates stored forecasts and recommendations. Nothing here imports the Excel files automatically.
