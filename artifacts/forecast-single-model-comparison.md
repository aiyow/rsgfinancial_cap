# Forecast comparison without ensemble

Source snapshot: 2026-10-03T15:56:05.609Z. 551 identical eligible unit/month pairs, June-September 2026.

Retrospective development comparison on the same eligible pairs as the prior investigation. Training uses earlier months only and 5-12 consecutive valid readings. Individual component models are forced for all eligible histories; adaptive selects one model without averaging. Current stable policy keeps its regression fallback. Forecasts rounded to 3 decimals. No live data or application policy changed.

Accuracy = max(0, 100 - WAPE), where WAPE = 100 * sum(abs(predicted - actual)) / sum(actual). This is not the probability of a correct forecast or a guarantee of future accuracy.

| Model | Overall accuracy | September accuracy | MAE (m3) | RMSE (m3) |
| --- | ---: | ---: | ---: | ---: |
| LINEAR_REGRESSION | 52.12% | 35.44% | 2.662 | 4.793 |
| RECENT_5_MONTH_LINEAR_REGRESSION | 52.09% | 37.06% | 2.663 | 4.943 |
| RECENT_3_MONTH_AVERAGE | 59.42% | 43.95% | 2.256 | 4.343 |
| RECENT_WEIGHTED_LINEAR_REGRESSION | 53.73% | 39.40% | 2.572 | 4.743 |
| RECENT_5_MONTH_MEDIAN | 58.35% | 47.20% | 2.315 | 4.450 |
| LAST_MONTH_CONSUMPTION | 59.00% | 47.27% | 2.279 | 4.344 |
| ADAPTIVE_SINGLE_MODEL | 55.84% | 45.97% | 2.455 | 4.670 |
| CURRENT_STABLE_POLICY | 57.92% | 47.77% | 2.339 | 4.168 |

Complete pair predictions and monthly scores: forecast-single-model-comparison.json.
