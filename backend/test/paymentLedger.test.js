import assert from "node:assert/strict";
import test from "node:test";
import { allocateCredit, manualReference } from "../services/paymentLedger.js";

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
