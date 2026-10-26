import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { passwordIssues, passwordError, passwordRequirements } from '../services/passwordPolicy.js';
import { newPasswordSchema } from '../services/passwordValidation.js';
import authRoutes from '../routes/authRoutes.js';
import userRoutes from '../routes/userRoutes.js';

const strong = 'Maple7!xyZab';
const missingRequirements = [
  ['Maple7!xyZa', 'length'],
  [strong.padEnd(129, 'x'), 'length'],
  ['maple7!xyzab', 'uppercase'],
  ['MAPLE7!XYZAB', 'lowercase'],
  ['Maplex!xyZab', 'number'],
  ['Maple77xyZab', 'symbol'],
];

test('accepts 12–128 Unicode characters and preserves the exact password', () => {
  for (const password of [strong, strong.padEnd(128, 'x'), 'Aa1!' + '😀'.repeat(124), 'Éclair7!xyZa', ' ' + strong + ' ']) {
    assert.equal(newPasswordSchema.parse(password), password);
    assert.deepEqual(passwordIssues(password), []);
    assert.ok(Array.from(password).length >= 12 && Array.from(password).length <= 128);
  }
  assert.equal(newPasswordSchema.safeParse('Maple7!xyZa').success, false);
  assert.equal(newPasswordSchema.safeParse(strong.padEnd(129, 'x')).success, false);
});

test('each missing requirement independently blocks acceptance and turns its checklist row off', () => {
  assert.equal(passwordRequirements('').length, 5);
  assert.ok(passwordRequirements('').every(requirement => !requirement.passed));
  assert.deepEqual(passwordRequirements(strong).map(requirement => requirement.code), ['length', 'uppercase', 'lowercase', 'number', 'symbol']);
  for (const [password, missing] of missingRequirements) {
    assert.deepEqual(passwordIssues(password).map(issue => issue.code), [missing]);
    assert.deepEqual(passwordRequirements(password).filter(requirement => !requirement.passed).map(requirement => requirement.code), [missing]);
    assert.equal(newPasswordSchema.safeParse(password).success, false);
  }
  assert.ok(passwordRequirements(strong).every(requirement => requirement.passed));
});

test('punctuation counts as a symbol; spaces, line breaks and letters do not', () => {
  for (const [first, last] of [[33, 47], [58, 64], [91, 96], [123, 126]]) {
    for (let code = first; code <= last; code++) {
      assert.equal(newPasswordSchema.safeParse('Maple7xyZab' + String.fromCharCode(code)).success, true);
    }
  }
  for (const password of ['Maple7 xyZab', 'Maple7\nxyZab', 'Maple77xyZab']) {
    assert.deepEqual(passwordIssues(password).map(issue => issue.code), ['symbol']);
  }
});

test('confirmation is exact, including spaces and case', () => {
  assert.equal(passwordError(strong, strong), '');
  assert.match(passwordError(strong, strong + ' '), /do not match/);
  assert.match(passwordError(strong, strong.toUpperCase()), /do not match/);
});

test('browser and API policy stay identical across independent deployment roots', async () => {
  assert.equal(await readFile(new URL('../services/passwordPolicy.js', import.meta.url), 'utf8'),
    await readFile(new URL('../../frontend/src/utils/passwordPolicy.js', import.meta.url), 'utf8'));
});

// Exercise the actual route validation middleware without opening a DB connection,
// hashing, sending email, or executing a handler that can change an account.
function validate(router, path, method, index, body) {
  const route = router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route;
  const req = { body };
  let status = 200;
  let payload;
  let passed = false;
  const res = { status(value) { status = value; return this; }, json(value) { payload = value; } };
  route.stack[index].handle(req, res, () => { passed = true; });
  return { status, payload, passed, body: req.validatedBody };
}

const email = 'policy@example.invalid';
const newPasswordRoutes = [
  { router: authRoutes, path: '/register', method: 'post', index: 0, body: { email, fullName: 'Policy Test', registrationToken: 't'.repeat(43) }, field: 'password' },
  { router: authRoutes, path: '/reset-password', method: 'post', index: 0, body: { email, resetToken: 'r'.repeat(43) }, field: 'password' },
  { router: authRoutes, path: '/change-password', method: 'post', index: 2, body: { currentPassword: 'old12345' }, field: 'newPassword' },
  { router: userRoutes, path: '/', method: 'post', index: 0, body: { email, fullName: 'Policy Test', role: 'RESIDENT' }, field: 'password' },
  { router: userRoutes, path: '/:id', method: 'patch', index: 1, body: {}, field: 'password' },
];
for (const entry of newPasswordRoutes) {
  test(`API ${entry.method} ${entry.path} enforces the new policy`, () => {
    const run = password => validate(entry.router, entry.path, entry.method, entry.index, { ...entry.body, [entry.field]: password });
    for (const weak of missingRequirements.map(([password]) => password)) {
      const result = run(weak);
      assert.equal(result.status, 400);
      assert.equal(result.passed, false);
      assert.ok(result.payload.errors.some(error => error.field === entry.field));
    }
    assert.equal(run(strong).passed, true);
    assert.equal(run(strong.padEnd(128, 'x')).passed, true);
  });
}

test('existing 8-character credentials still pass sign-in and current-password validation', () => {
  assert.equal(validate(authRoutes, '/login', 'post', 0, { email, password: 'old12345' }).passed, true);
  assert.equal(validate(authRoutes, '/change-password', 'post', 2, { currentPassword: 'old12345', newPassword: strong }).passed, true);
  const longPassword = 'Aa1!' + '😀'.repeat(124);
  assert.equal(validate(authRoutes, '/login', 'post', 0, { email, password: longPassword }).passed, true);
  assert.equal(validate(authRoutes, '/change-password', 'post', 2, { currentPassword: longPassword, newPassword: strong }).passed, true);
});

test('admin edits may omit a new password, but cannot submit an empty or weak one', () => {
  const run = body => validate(userRoutes, '/:id', 'patch', 1, body);
  assert.equal(run({ fullName: 'Updated Name' }).passed, true);
  assert.equal(run({ fullName: 'Updated Name', password: '' }).status, 400);
});

