import assert from 'node:assert/strict'
import test from 'node:test'
import { scrollToLogin } from '../src/utils/loginNavigation.js'

function sectionFixture() {
  const calls = []
  return { calls, section: { scrollIntoView: options => calls.push(['scroll', options]), focus: options => calls.push(['focus', options]) } }
}

test('login cue scrolls smoothly and focuses the section without opening an input', () => {
  const { calls, section } = sectionFixture()
  assert.equal(scrollToLogin(section), true)
  assert.deepEqual(calls, [['scroll', { behavior: 'smooth', block: 'start' }], ['focus', { preventScroll: true }]])
})

test('reduced motion uses immediate scrolling', () => {
  const { calls, section } = sectionFixture()
  scrollToLogin(section, true)
  assert.equal(calls[0][1].behavior, 'auto')
})

test('missing login section leaves native anchor navigation available', () => {
  assert.equal(scrollToLogin(null), false)
})
