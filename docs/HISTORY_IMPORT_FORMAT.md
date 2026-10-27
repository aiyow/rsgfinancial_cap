# Analytics history spreadsheet

The Billing Associate history-upload page requires only `UNIT`, `PREVIOUS`, and `CURRENT`. `PRESENT` is accepted instead of `CURRENT`, and `UNITS` is accepted instead of `UNIT`. Headers ignore surrounding whitespace and case.

Consumption is computed from current minus previous reading. Spreadsheet `CONSUMPTION`, `WRATE`, `WATER BILLED`, and other extra columns are ignored. Original uploaded workbook bytes are retained unchanged for later downloads. Existing saved reading exports remain compatible because extra columns are optional.

The preview displays unit, previous/current readings, computed consumption, and validation only. It does not require or display a spreadsheet rate or water charge. Unit existence, duplicate units, complete unit coverage, numeric/non-negative readings, and flagged decreasing readings retain their existing validation behavior.

Financial analytics still use a saved rate internally. Replacing an imported month preserves that month's saved rate. A new month uses the latest preceding saved positive billing-period rate, or the earliest later one when importing older history. No zero or invented default rate is inserted when configuration is missing; the API asks the associate to configure a rate in Create Billing first. A matching live billing month uses its existing rate and only verifies the saved readings and refreshes forecasts; it does not overwrite live billing.

The older JSON integration can still supply an explicit rate; if omitted it uses the same saved-rate selection. This change affects the web upload flow; it does not rewrite retained workbooks, existing analytics history, or live SOAs.
