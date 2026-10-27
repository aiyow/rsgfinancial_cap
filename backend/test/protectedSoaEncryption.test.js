import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, rm, readdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryptSoaPdf, runQpdf, cleanupSoaTemporaryFiles } from '../services/soaEncryption.js';
import { renderSoaPdf, loadSoaLogo } from '../services/soaPdf.js';
import { defaultSoaTemplate } from '../services/soaTemplate.js';

test('actual qpdf rejects missing/wrong passwords, accepts emailed password, R6 AES-256, allows printing and cleans plaintext', { skip: !process.env.QPDF_PATH }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'soa-encryption-test-'));
  const root = join(tmpdir(), 'residens-protected-soa');
  let password = randomBytes(18).toString('base64url');
  assert.equal(password.length, 24);
  try {
    const charges = [{ chargeType: 'WATER', amount: 85.38, rateApplied: 23 }, { chargeType: 'ASSOCIATION_DUES', description: 'Association dues', amount: 1608.84 }];
    const bill = { soaTemplate: defaultSoaTemplate, charges, unitNumber: '234', floor: '2', payerName: 'José Niño de la Peña', periodStart: '2026-10-05', periodEnd: '2026-11-05', statementDate: '2026-10-27', dueDate: '2026-11-10', totalAmount: 1694.22, remainingBalance: 1494.22, approvedAmount: 200, chargePayments: { WATER: { billedAmount: 85.38, remainingBalance: 85.38 }, ASSOCIATION_DUES: { billedAmount: 1608.84, remainingBalance: 1408.84, approvedAmount: 200, invoiceReferences: ['INV-0123'] } } };
    const plaintext = await renderSoaPdf(bill, 'SX-ENCRYPTION-FIXTURE', await loadSoaLogo(null));
    const encrypted = await encryptSoaPdf(plaintext, password);
    const path = join(directory, 'encrypted.pdf'); await writeFile(path, encrypted);
    await assert.rejects(runQpdf(['--check', path]));
    await assert.rejects(runQpdf(['--password=wrong', '--check', path]));
    await runQpdf([`--password=${password}`, '--check', path]);
    const inspection = (await runQpdf([`--password=${password}`, '--show-encryption', path])).toString();
    assert.match(inspection, /R = 6\b/); assert.match(inspection, /AESv3/); assert.match(inspection, /print high resolution: allowed/);
    assert.equal((await runQpdf([`--password=${password}`, '--show-npages', path])).toString().trim(), '1', 'No accidental footer-only page');
    assert.ok(!encrypted.includes(Buffer.from(password))); assert.ok(!encrypted.includes(Buffer.from('José')));
    const before = await readdir(root);
    await assert.rejects(encryptSoaPdf(plaintext, password, { binary: join(directory, 'missing-qpdf') }));
    assert.deepEqual(await readdir(root), before, 'Failed encryption removes seekable plaintext');
    const abandoned = await mkdtemp(join(root, 'job-')); await writeFile(join(abandoned, 'statement.pdf'), plaintext);
    const old = new Date(Date.now() - 360000); await utimes(abandoned, old, old);
    await cleanupSoaTemporaryFiles(); assert.ok(!(await readdir(root)).includes(abandoned.split(/[\\/]/).at(-1)));
    if (process.env.SOA_PDF_FIXTURE_DIR) {
      // Only synthetic statements, never a resident's data. Unlocked fixture is
      // for visual/text QA; no test password is persisted alongside the artifact.
      await writeFile(join(process.env.SOA_PDF_FIXTURE_DIR, 'statement-preview.pdf'), plaintext);
    }
    plaintext.fill(0);
  } finally { password = null; await rm(directory, { recursive: true, force: true }); }
});
