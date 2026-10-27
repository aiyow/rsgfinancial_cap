import assert from 'node:assert/strict';
import test from 'node:test';
import * as server from "../services/billing.js";
import * as browser from '../../frontend/src/utils/billingPeriodPolicy.js';

const valid = { periodStart: '2026-01-31', periodEnd: '2026-02-28', dueDate: '2026-03-28', waterRatePerCubicM: 23, associationDuesRatePerSqm: 134.07, latePenaltyPercent: 0 };

for (const [name, policy] of [['API', server], ['browser', browser]]) {
  test(`${name}: calendar months clamp at month end and account for leap years and year rollover`, () => {
    for (const [start, months, end] of [
      ['2026-01-31', 1, '2026-02-28'], ['2028-01-31', 1, '2028-02-29'],
      ['2026-01-31', 2, '2026-03-31'], ['2026-12-31', 2, '2027-02-28'],
      ['2026-11-30', 1, '2026-12-30'], ['2028-02-29', 1, '2028-03-29'],
    ]) assert.equal(policy.addCalendarMonths(start, months), end);
    assert.deepEqual(policy.billingPeriodDateBounds(valid), { periodEndMin: '2026-02-28', periodEndMax: '2026-03-31', dueDateMin: '2026-03-01', dueDateMax: '2026-03-28' });
    assert.equal(policy.billingPeriodDateBounds({ periodEnd: '2028-02-28' }).dueDateMin, '2028-02-29');
    assert.equal(policy.billingPeriodDateBounds({ periodEnd: '2026-12-31' }).dueDateMin, '2027-01-01');
  });

  test(`${name}: valid periods include exactly one and two calendar months`, () => {
    for (const [periodStart, periodEnd, dueDate] of [
      ['2026-01-31', '2026-02-28', '2026-03-01'],
      ['2028-01-31', '2028-02-29', '2028-03-29'],
      ['2026-01-31', '2026-03-31', '2026-04-30'],
      ['2026-12-31', '2027-01-31', '2027-02-28'],
      ['2026-02-01', '2026-03-01', '2026-03-02'],
    ]) assert.deepEqual(policy.billingPeriodErrors({ ...valid, periodStart, periodEnd, dueDate }), {});
    assert.deepEqual(policy.billingPeriodErrors({ ...valid, waterRatePerCubicM: '0.01', associationDuesRatePerSqm: '0.01', latePenaltyPercent: 100 }), {});
  });

  test(`${name}: rates cannot be zero, negative, missing, nonfinite or round down to zero`, () => {
    for (const field of ['waterRatePerCubicM', 'associationDuesRatePerSqm']) {
      for (const value of [0, '0', -1, '', ' ', null, undefined, false, Infinity, NaN, 'invalid', 0.001]) {
        assert.match(policy.billingPeriodErrors({ ...valid, [field]: value })[field], /greater than zero/, `${field}: ${String(value)}`);
      }
    }
  });

  test(`${name}: real date checks reject rollover dates, non-leap February and year zero`, () => {
    for (const field of ['periodStart', 'periodEnd', 'dueDate']) {
      for (const value of ['', null, '2026-02-29', '2028-02-30', '2026-04-31', '2026-13-01', '0000-01-01', '26-01-01']) {
        assert.ok(policy.billingPeriodErrors({ ...valid, [field]: value })[field], `${field}: ${value}`);
      }
    }
    assert.equal(policy.isBillingDate('2028-02-29'), true);
    assert.equal(policy.isBillingDate('2000-02-29'), true);
    assert.equal(policy.isBillingDate('2100-02-29'), false);
  });

  test(`${name}: date ordering and minimum/maximum gaps reject every out-of-range boundary`, () => {
    for (const [overrides, field, expected] of [
      [{ periodEnd: '2025-12-31' }, 'periodEnd', /after period start/],
      [{ periodEnd: valid.periodStart }, 'periodEnd', /after period start/],
      [{ periodEnd: '2026-02-27' }, 'periodEnd', /at least 1/],
      [{ periodEnd: '2026-04-01', dueDate: '2026-04-02' }, 'periodEnd', /not exceed 2/],
      [{ periodStart: '2028-01-31', periodEnd: '2028-02-28', dueDate: '2028-03-01' }, 'periodEnd', /at least 1/],
      [{ dueDate: '2026-02-27' }, 'dueDate', /after period end/],
      [{ dueDate: valid.periodEnd }, 'dueDate', /after period end/],
      [{ dueDate: '2026-03-29' }, 'dueDate', /within 1/],
      [{ periodStart: '2025-12-31', periodEnd: '2026-01-31', dueDate: '2026-03-01' }, 'dueDate', /within 1/],
    ]) assert.match(policy.billingPeriodErrors({ ...valid, ...overrides })[field], expected);
  });
}
