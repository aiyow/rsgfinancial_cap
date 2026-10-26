import assert from 'node:assert/strict';
import test from 'node:test';
import authRoutes from '../routes/authRoutes.js';

// Invoke production validation only; no account creation, DB query, or email.
const validator = authRoutes.stack.find(layer => layer.route?.path === '/register').route.stack[0].handle;
function validate(body) {
  const req = { body };
  let status = 200;
  let passed = false;
  let payload;
  const res = { status(value) { status = value; return this; }, json(value) { payload = value; } };
  validator(req, res, () => { passed = true; });
  return { status, passed, payload, body: req.validatedBody };
}
const account = { registrationToken: 't'.repeat(43), firstName: 'Jane', lastName: 'Doe', email: 'names@example.invalid', password: 'Maple7!xyZab' };

test('registration accepts optional MI or 1–2 letters with one optional final period', () => {
  for (const middleInitial of ['', 'J', 'j', 'JP', 'jp', 'J.', 'j.', 'JP.', 'jp.']) {
    const result = validate({ ...account, middleInitial });
    assert.equal(result.passed, true);
    assert.equal(result.body.fullName, ['Jane', middleInitial, 'Doe'].filter(Boolean).join(' '));
  }
  assert.equal(validate(account).body.fullName, 'Jane Doe');
});

test('registration rejects nonletters, misplaced/repeated periods, spaces, and excess letters', () => {
  for (const middleInitial of ['ABC', 'ABCD', '.', '..', 'J..', 'J.P', '.J', '1', 'J1', 'J P', ' J', 'J ', ' ', 'É', 'J\n', 'JP.\r\n']) {
    const result = validate({ ...account, middleInitial });
    assert.equal(result.status, 400, JSON.stringify(middleInitial));
    assert.equal(result.passed, false);
  }
});

test('the server assembles trimmed names and preserves 100-character individual and 205-character complete-name limits', () => {
  const result = validate({ ...account, firstName: '  Jane Marie ', middleInitial: 'AB.', lastName: ' De la Cruz ' });
  assert.equal(result.body.fullName, 'Jane Marie AB. De la Cruz');
  assert.equal(validate({ ...account, firstName: ' ', middleInitial: 'J' }).status, 400);
  assert.equal(validate({ ...account, lastName: '' }).status, 400);
  assert.equal(validate({ ...account, firstName: 'a'.repeat(101) }).status, 400);
  assert.equal(validate({ ...account, lastName: 'b'.repeat(101) }).status, 400);
  const longest = validate({ ...account, firstName: 'a'.repeat(100), middleInitial: 'AB.', lastName: 'b'.repeat(100) });
  assert.equal(longest.passed, true);
  assert.equal(longest.body.fullName.length, 205);
});

test('fullName clients still require verified-email proof', () => {
  const result = validate({ fullName: 'Jane Doe', email: account.email, password: account.password, registrationToken: account.registrationToken });
  assert.equal(result.passed, true);
  assert.equal(result.body.fullName, 'Jane Doe');
});
