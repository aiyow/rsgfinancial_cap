import assert from "node:assert/strict";
import test from "node:test";
import { allocateCredit, applyDueLatePenalties, calculateLatePenalty, manualReference } from "../services/paymentLedger.js";

test("allocates one payment across a bill and leaves advance balance", () => {
  const result = allocateCredit({
    billRemaining: 750,
    paymentCredits: [{ paymentSubmissionId: 10, availableAmount: 1000 }],
  });
  assert.deepEqual(result.applications, [{ paymentSubmissionId: 10, amountApplied: 750 }]);
  assert.equal(result.remainingBalance, 0);
});

test("allocates multiple partial payments in order", () => {
  const result = allocateCredit({
    billRemaining: 1000,
    paymentCredits: [
      { paymentSubmissionId: 1, availableAmount: 250 },
      { paymentSubmissionId: 2, availableAmount: 300 },
      { paymentSubmissionId: 3, availableAmount: 900 },
    ],
  });
  assert.deepEqual(result.applications, [
    { paymentSubmissionId: 1, amountApplied: 250 },
    { paymentSubmissionId: 2, amountApplied: 300 },
    { paymentSubmissionId: 3, amountApplied: 450 },
  ]);
  assert.equal(result.remainingBalance, 0);
});

test("keeps bill balance when credit is insufficient", () => {
  const result = allocateCredit({
    billRemaining: 1000,
    paymentCredits: [{ paymentSubmissionId: 4, availableAmount: 275.25 }],
  });
  assert.deepEqual(result.applications, [{ paymentSubmissionId: 4, amountApplied: 275.25 }]);
  assert.equal(result.remainingBalance, 724.75);
});

test("generates traceable manual references", () => {
  assert.equal(manualReference("CASH", 12), "CASH-00000012");
  assert.equal(manualReference("BANK_TRANSFER", 12), "BANKTRANSFER-00000012");
});

test("applies a one-time percentage penalty only after the due date", () => {
  assert.equal(calculateLatePenalty(1000, 5, true), 50);
  assert.equal(calculateLatePenalty(1000, 5, false), 0);
  assert.equal(calculateLatePenalty(1000, 0, true), 0);
});

test("uses an explicitly supplied local calendar date when applying late penalties", async () => {
  const calls = [];
  await applyDueLatePenalties({
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('to_regclass')) return { rows: [{ policy: 'payment_ledger_policy' }] };
      if (sql.includes('SELECT version')) return { rows: [{ version: 2 }] };
      return { rows: [] };
    },
  }, null, "2026-10-01");

  assert.ok(calls.some(call=>call.sql.includes('FOR UPDATE')));
  assert.ok(calls.some(call=>call.sql.includes("p.verified_payment_date <= b.due_date_snapshot")));
  assert.deepEqual(calls.at(-1).values, [null]);
});
