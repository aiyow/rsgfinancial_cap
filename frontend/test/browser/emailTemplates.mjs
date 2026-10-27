// Render synthetic emails only. No SMTP or live application API is used.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  buildRegistrationEmailMessage,
  buildVerificationEmailMessage,
  buildEmailChangeMessage,
  buildSoaEmailMessage,
  buildSoaReminderEmailMessage,
  buildProtectedSoaEmailMessage,
  EMAIL_COMPANY_NAME,
  escapeHtml,
} from "../../../backend/services/email.js";
import { buildPasswordResetEmailMessage } from "../../../backend/services/passwords.js";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const output = fileURLToPath(new URL('../../../artifacts/email-styling/', import.meta.url))
await mkdir(output, { recursive: true })
const fullName = 'Juan de la Paz'
const delivery = { billId: 42, recipientName: fullName, unitNumber: '307', periodStart: '2026-10-05', periodEnd: '2026-11-05', dueDate: '2026-11-10', remainingBalance: 2228.24, waterBalance: 392.82, associationBalance: 1835.42, relationshipType: 'OWNER' }
const args = { fullName, otp: '012345' }
const clientUrl = 'https://condo.example.invalid'
const messages = [
  ['registration', buildRegistrationEmailMessage(args)],
  ['verification', buildVerificationEmailMessage({ fullName, token: 'synthetic-preview-only', clientUrl })],
  ['email-change', buildEmailChangeMessage(args)],
  ['password-reset', buildPasswordResetEmailMessage(args)],
  ['soa-available', buildSoaEmailMessage({ delivery, clientUrl })],
  ...['DUE_SOON', 'DUE_TODAY', 'OVERDUE'].map(reminderType => [reminderType.toLowerCase().replaceAll('_', '-'), buildSoaReminderEmailMessage({ delivery, reminderType, clientUrl })]),
  ['protected-soa', buildProtectedSoaEmailMessage({ residentName: fullName, ...delivery, reference: 'SX-PREVIEW', password: 'delapaz4827' })],
]
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const [name, message] of messages) {
    await writeFile(`${output}/${name}.html`, message.html)
    for (const width of [720, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } })
      await page.route('**/*', route => { throw new Error(`Email tried to fetch an external resource: ${route.request().url()}`) })
      await page.setContent(message.html)
      assert.equal(await page.locator('h1').count(), 1, name)
      assert.ok(await page.getByText(EMAIL_COMPANY_NAME, { exact: true }).isVisible(), name)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} must fit ${width}px`)
      assert.doesNotMatch(await page.locator('body').innerText(), /undefined|NaN/)
      if (['registration', 'email-change', 'password-reset'].includes(name)) assert.ok(await page.getByText('012345', { exact: true }).isVisible())
      if (name === 'protected-soa') assert.ok(await page.getByText('delapaz4827', { exact: true }).isVisible())
      await page.screenshot({ path: `${output}/${name}-${width}px.png`, fullPage: true })
      await page.close()
    }
    console.log(`${name}: desktop, 390px and 320px layouts passed`)
  }
  const links = messages.map(([name, message]) => `<li><a href="${name}.html">${escapeHtml(message.subject)}</a></li>`).join('')
  await writeFile(`${output}/index.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email previews</title><body style="font:16px/1.8 Arial,sans-serif;padding:24px;color:#183c2c;background:#f2f6f3"><h1>System email previews</h1><p>Synthetic examples using the shared ResiDens email style.</p><ul>${links}</ul></body></html>`)
} finally { await browser.close() }
