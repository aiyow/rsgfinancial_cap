import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateFinancialCollection, calculateCollectionEfficiency, parseFinancialReportFilters } from '../services/financialReports.js';

test('defaults financial reports to the current calendar month', () => {
  const result = parseFinancialReportFilters({}, new Date('2026-09-16T08:00:00.000Z'));
  assert.deepEqual(result, {
    mode: 'MONTH', month: '2026-09', startDate: '2026-09-01', endDate: '2026-09-30', label: '2026-09',
  });
});

test('accepts an inclusive custom report date range', () => {
  assert.deepEqual(parseFinancialReportFilters({ startDate: '2026-02-03', endDate: '2026-02-28' }), {
    mode: 'DATE_RANGE', month: null, startDate: '2026-02-03', endDate: '2026-02-28', label: '2026-02-03 to 2026-02-28',
  });
});

test('rejects mixed, incomplete, and reversed financial report filters', () => {
  assert.throws(() => parseFinancialReportFilters({ month: '2026-02', startDate: '2026-02-01', endDate: '2026-02-28' }), /either a month or a date range/);
  assert.throws(() => parseFinancialReportFilters({ startDate: '2026-02-01' }), /both startDate and endDate/);
  assert.throws(() => parseFinancialReportFilters({ startDate: '2026-02-28', endDate: '2026-02-01' }), /cannot be after/);
});

test('splits partial collections proportionally and reconciles exactly', () => {
  const result = allocateFinancialCollection({ waterBilled: 200, duesBilled: 800, latePenalty: 50, amountApplied: 525 });
  assert.deepEqual(result, { waterCollected: 100, duesCollected: 400, latePenaltyCollected: 25 });
  assert.equal(result.waterCollected + result.duesCollected + result.latePenaltyCollected, 525);
});

test('uses deterministic cent rounding when a partial payment cannot divide evenly', () => {
  const result = allocateFinancialCollection({ waterBilled: 1, duesBilled: 1, latePenalty: 1, amountApplied: 1 });
  assert.equal(result.waterCollected + result.duesCollected + result.latePenaltyCollected, 1);
  assert.deepEqual(result, { waterCollected: 0.34, duesCollected: 0.33, latePenaltyCollected: 0.33 });
});

test('calculates collection efficiency from approved collections and billed amounts', () => {
  assert.equal(calculateCollectionEfficiency(750, 1000), 75);
  assert.equal(calculateCollectionEfficiency(1000, 0), null);
});
