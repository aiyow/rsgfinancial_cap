import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { DEFAULT_SITE_URL, SEARCH_DESCRIPTION, SEARCH_TITLE, publicSiteOrigin, searchDiscovery, searchFiles } from '../search-discovery.mjs'

test('uses the supplied production frontend URL and accepts its login URL', () => {
  assert.equal(publicSiteOrigin(), 'https://residens-condo.onrender.com')
  assert.equal(publicSiteOrigin(DEFAULT_SITE_URL + '/login'), DEFAULT_SITE_URL)
  for (const value of ['http://example.com', 'https://u:p@example.com', 'https://example.com/api', 'https://example.com/?token=1', 'https://example.com/#fragment']) {
    assert.throws(() => publicSiteOrigin(value))
  }
})

test('sitemap lists only the public login page and robots permits reading noindex headers', () => {
  const files = searchFiles()
  assert.match(files.robots, /Allow: \/\n/)
  assert.match(files.robots, /Sitemap: https:\/\/residens-condo.onrender.com\/sitemap.xml/)
  assert.match(files.sitemap, /<loc>https:\/\/residens-condo.onrender.com\/login<\/loc>/)
  assert.equal((files.sitemap.match(/<loc>/g) || []).length, 1)
  assert.ok(!/resident\/|admin|collector|reset-password|register/.test(files.sitemap))
  assert.ok(!files.robots.includes('Disallow: /resident'))
})

test('canonical/social metadata use the public site and verification is opt-in', () => {
  const tags = searchDiscovery().transformIndexHtml()
  assert.equal(tags.find(tag => tag.attrs.rel === 'canonical').attrs.href, DEFAULT_SITE_URL + '/login')
  assert.equal(tags.some(tag => tag.attrs.name === 'google-site-verification'), false)
  const verified = searchDiscovery({ siteUrl: 'https://portal.example.com', verification: ' fixture-code ' }).transformIndexHtml()
  assert.equal(verified.find(tag => tag.attrs.name === 'google-site-verification').attrs.content, 'fixture-code')
  assert.equal(verified.find(tag => tag.attrs.property === 'og:url').attrs.content, 'https://portal.example.com/login')
})

test('build emits real crawler files and public HTML has content without JavaScript', async () => {
  const emitted = []
  searchDiscovery().generateBundle.call({ emitFile: asset => emitted.push(asset) })
  assert.deepEqual(emitted.map(file => file.fileName), ['robots.txt', 'sitemap.xml'])
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')
  assert.ok(html.includes(`<title>${SEARCH_TITLE}</title>`))
  assert.ok(html.includes(SEARCH_DESCRIPTION))
  assert.match(html, /<h1>The ResiDens Condominium Resident Portal<\/h1>/)
  assert.match(html, /<a href="\/login">/)
  assert.match(html, /name="robots" content="index, follow"/)
})

test('Render sets noindex headers for all non-public application route families', async () => {
  const blueprint = (await readFile(new URL('../../render.yaml', import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
  for (const route of ['admin', 'collector', 'resident', 'profile', 'settings', 'notifications', 'register', 'forgot-password', 'reset-password', 'verify-email', 'pending-approval']) {
    assert.ok(blueprint.includes(`path: /${route}\n        name: X-Robots-Tag\n        value: noindex, nofollow`))
  }
  for (const route of ['admin', 'collector', 'resident']) assert.ok(blueprint.includes(`path: /${route}/**\n        name: X-Robots-Tag\n        value: noindex, nofollow`))
  assert.ok(!blueprint.includes('path: /login'))
})
