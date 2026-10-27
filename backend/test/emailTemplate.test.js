import assert from 'node:assert/strict';
import test from 'node:test';
import { emailDate, buildSoaEmailMessage, buildSoaReminderEmailMessage } from "../services/email.js";

test('email dates use full months without a timezone shift or silent calendar rollover', () => {
  assert.equal(emailDate('2026-01-01'), 'January 1, 2026');
  assert.equal(emailDate('2026-10-05'), 'October 5, 2026');
  assert.equal(emailDate(new Date('2026-01-01T00:00:00Z')), 'January 1, 2026');
  assert.equal(emailDate('2024-02-29'), 'February 29, 2024');
  for (const value of ['2026-02-29', '2026-02-30', '2026-13-01', 'invalid', new Date('invalid')]) assert.equal(emailDate(value), 'Not specified');
  assert.equal(emailDate(null), '');
});

test('SOA availability and all reminder emails use full month dates in HTML and plain text', () => {
  const delivery = { recipientName: 'Tanjiro Kamado', unitNumber: '307', billId: 1, periodStart: '2026-10-05', periodEnd: '2026-11-05', dueDate: '2026-11-09' };
  const messages = [buildSoaEmailMessage({ delivery }), ...['DUE_SOON', 'DUE_TODAY', 'OVERDUE'].map(reminderType => buildSoaReminderEmailMessage({ delivery, reminderType }))];
  for (const message of messages) for (const content of [message.html, message.text]) {
    assert.match(content, /October 5, 2026 to November 5, 2026/);
    assert.match(content, /November 9, 2026/);
    assert.doesNotMatch(content, /2026-10-05|2026-11-09/);
  }
});
