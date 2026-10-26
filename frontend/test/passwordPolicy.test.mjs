import assert from 'node:assert/strict'
import test from 'node:test'
import { passwordError, passwordIssues, passwordRequirements } from '../src/utils/passwordPolicy.js'

test('browser requires all five password rules and matching confirmation', () => {
  const password = 'Maple7!xyZab'
  assert.equal(passwordRequirements(password).length, 5)
  assert.ok(passwordRequirements(password).every(requirement => requirement.passed))
  assert.deepEqual(passwordIssues(password), [])
  assert.equal(passwordError(password, password), '')
  assert.equal(passwordError(password.padEnd(128, 'x')), '')
  assert.equal(passwordError('Aa1!' + '😀'.repeat(124)), '')
  assert.match(passwordError(password, password + ' '), /do not match/)
  for (const invalid of ['Maple7!xyZa', password.padEnd(129, 'x'), 'maple7!xyzab', 'MAPLE7!XYZAB', 'Maplex!xyZab', 'Maple77xyZab']) {
    assert.equal(passwordIssues(invalid).length, 1)
    assert.notEqual(passwordError(invalid), '')
  }
})
