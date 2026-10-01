import assert from "node:assert/strict";
import test from "node:test";
import { REMINDER_TYPES, dateInTimezone, reminderTypeForDueDate, runSoaReminderJob } from "../services/soaReminderScheduler.js";

test("classifies three-day, due-today, and overdue reminder states", () => {
  assert.equal(reminderTypeForDueDate("2026-10-04", "2026-10-01"), REMINDER_TYPES.DUE_SOON);
  assert.equal(reminderTypeForDueDate("2026-10-01", "2026-10-01"), REMINDER_TYPES.DUE_TODAY);
  assert.equal(reminderTypeForDueDate("2026-09-30", "2026-10-01"), REMINDER_TYPES.OVERDUE);
  assert.equal(reminderTypeForDueDate("2026-10-05", "2026-10-01"), null);
});

test("uses the Philippines calendar date regardless of the server timezone", () => {
  assert.equal(dateInTimezone(new Date("2026-09-30T16:30:00Z"), "Asia/Manila"), "2026-10-01");
});

test("sends one current-status catch-up reminder and records it as sent", async () => {
  const responses = [
    { rows: [] },
    { rows: [{
      billId: 14, unitNumber: "1201", periodStart: "2026-09-01", periodEnd: "2026-09-30",
      dueDate: "2026-09-30", latePenaltyAmount: 0, recipientUserId: 7,
      recipientName: "Ava", recipientEmail: "ava@example.com", remainingBalance: 500,
    }] },
    { rows: [] },
    { rows: [{ id: 22 }] },
    { rows: [{ id: 22, attemptCount: 1 }] },
    { rows: [] },
  ];
  const calls = [];
  const database = {
    async query(sql, values) {
      calls.push({ sql, values });
      return responses.shift() || { rows: [] };
    },
  };
  const sent = [];
  const logger = { log() {}, error() {} };

  const summary = await runSoaReminderJob({
    database,
    now: new Date("2026-10-01T01:00:00Z"),
    applyLatePenalties: async () => [],
    sendReminder: async (delivery, type) => sent.push({ delivery, type }),
    logger,
  });

  assert.deepEqual(summary, { today: "2026-10-01", candidates: 1, sent: 1, failed: 0, skipped: 0 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, REMINDER_TYPES.OVERDUE);
  assert.match(calls.at(-1).sql, /status = 'SENT'/);
});

test("records an SMTP error so the current reminder can be retried", async () => {
  const responses = [
    { rows: [] },
    { rows: [{
      billId: 15, unitNumber: "1202", periodStart: "2026-09-01", periodEnd: "2026-09-30",
      dueDate: "2026-10-01", latePenaltyAmount: 0, recipientUserId: 8,
      recipientName: "Ben", recipientEmail: "ben@example.com", remainingBalance: 600,
    }] },
    { rows: [] },
    { rows: [{ id: 23 }] },
    { rows: [{ id: 23, attemptCount: 1 }] },
    { rows: [] },
  ];
  const calls = [];
  const database = {
    async query(sql, values) {
      calls.push({ sql, values });
      return responses.shift() || { rows: [] };
    },
  };
  const logger = { log() {}, error() {} };

  const summary = await runSoaReminderJob({
    database,
    now: new Date("2026-10-01T01:00:00Z"),
    applyLatePenalties: async () => [],
    sendReminder: async () => { throw new Error("SMTP unavailable"); },
    logger,
  });

  assert.equal(summary.failed, 1);
  assert.match(calls.at(-1).sql, /status = 'FAILED'/);
});
