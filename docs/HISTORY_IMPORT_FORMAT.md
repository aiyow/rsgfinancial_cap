# Analytics history spreadsheet

The Billing Associate history-upload page requires only `UNIT`, `PREVIOUS`, and `CURRENT`. `PRESENT` is accepted instead of `CURRENT`, and `UNITS` is accepted instead of `UNIT`. Headers ignore surrounding whitespace and case.

Consumption is computed from current minus previous reading. The optional `WRATE` or `WATER RATE` column supplies the rate in pesos per cubic meter. Enter one positive monthly rate with up to two decimal places. If the rate appears on multiple rows, the values must match. The preview displays the rate from each row.

The importer recalculates consumption and water charges using the readings and the selected rate. It ignores the workbook's `CONSUMPTION` and `WATER BILLED` columns. Original uploaded workbook bytes are retained for later downloads.

New and replacement historical imports use the workbook rate when supplied. With no workbook rate, the importer uses the selected month's saved rate, the most recent preceding positive rate, or the earliest later positive rate, in that order. If none is available, the workbook must supply a rate or an associate must save one in Create Billing. For a month with a live batch, the workbook rate must match the live rate when provided.

The JSON integration can supply an explicit rate. If omitted, it uses the same saved-rate selection.
