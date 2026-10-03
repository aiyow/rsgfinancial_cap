import { readFile, writeFile } from 'node:fs/promises';
import { benchmarkDataset } from '../services/forecastEvaluation.js';
import { buildForecast, nextMonthStart } from '../services/predictiveAnalytics.js';
import { validateMeterReading } from '../services/meterReadingValidation.js';

const outputDir = new URL('../../artifacts/', import.meta.url);
const source = JSON.parse(await readFile(new URL('workbook-source.json', outputDir), 'utf8'));
const unitNames = [...new Set(source.workbooks.flatMap((book) => book.readings.map((row) => row.unitNumber)))].sort();
const units = unitNames.map((unitNumber) => ({ unitId: unitNumber, unitNumber }));
const periods = source.workbooks.map((book, index) => ({ id: index + 1, periodStart: book.periodStart, waterRate: book.readings[0].waterRate }));
const priorByUnit = new Map();
const flags = [];
const readings = source.workbooks.flatMap((book) => {
  if (book.readings.length !== units.length) throw new Error(`${book.periodStart}: missing units`);
  return book.readings.map((row) => {
    const quality = validateMeterReading(row.previousReading, row.currentReading, priorByUnit.get(row.unitNumber));
    priorByUnit.set(row.unitNumber, row.currentReading);
    if (quality.status !== 'VALID') flags.push({ periodStart: book.periodStart, unitNumber: row.unitNumber, notes: quality.notes });
    return { ...row, unitId: row.unitNumber, periodStart: book.periodStart, validationStatus: quality.status };
  });
});
const dataset = { capturedAt: new Date().toISOString(), units, periods, readings };
const report = benchmarkDataset(dataset);
const latest = periods.at(-1);
const nextForecasts = units.map((unit) => ({ unitNumber: unit.unitNumber, forecastForMonth: nextMonthStart(latest.periodStart),
  ...buildForecast(readings.filter((row) => row.unitId === unit.unitId), { sourceMonth: latest.periodStart, waterRate: latest.waterRate }),
}));
const connected = JSON.parse(await readFile(new URL('forecast-connected-dataset.json', outputDir), 'utf8'));
const connectedByUnit = new Map(connected.readings.map((row) => [`${row.unitNumber}:${row.periodStart}`, row]));
const databaseComparison = periods.map((period) => {
  const rows = readings.filter((row) => row.periodStart === period.periodStart);
  const missing = rows.filter((row) => !connectedByUnit.has(`${row.unitNumber}:${row.periodStart}`));
  const changed = rows.filter((row) => {
    const existing = connectedByUnit.get(`${row.unitNumber}:${row.periodStart}`);
    return existing && Math.abs(Number(existing.consumption) - row.consumption) > 0.001;
  });
  return { periodStart: period.periodStart, missingReadings: missing.length, changedConsumption: changed.length };
});
await writeFile(new URL('forecast-workbook-dataset.json', outputDir), JSON.stringify(dataset, null, 2));
await writeFile(new URL('forecast-workbook-benchmark.json', outputDir), JSON.stringify({ ...report,
  sourceFiles: source.workbooks.map((book) => book.path), flags, databaseComparison,
  formulaIssues: source.workbooks.flatMap((book) => book.formulaIssues.map((issue) => ({ ...issue, periodStart: book.periodStart }))), nextForecasts,
}, null, 2));
console.log(JSON.stringify({ aggregate: report.aggregate, latest: report.latest, acceptance: report.acceptance,
  flags: flags.length, databaseComparison, nextForecastMonth: nextMonthStart(latest.periodStart),
  nextReady: nextForecasts.filter((row) => row.status === 'READY').length,
}, null, 2));
