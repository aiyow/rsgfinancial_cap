import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { auditCoverage } from '../services/auditCoverage.js';

test('all application mutation endpoints declare audited or excluded coverage', async () => {
  const root = new URL('../routes/', import.meta.url);
  for (const file of await readdir(root)) {
    if (!file.endsWith('.js')) continue;
    const source = await readFile(new URL(file, root), 'utf8');
    const registry = auditCoverage[file.replace('.js', '')] || {};
    const declared = [...(registry.recorded || []), ...(registry.excluded || [])];
    assert.equal(new Set(declared).size, declared.length, file);
    for (const match of source.matchAll(/router\.(post|patch|put|delete)\(["']([^"']+)["']/g)) {
      const operation = `${match[1].toUpperCase()} ${match[2]}`;
      assert.ok(declared.includes(operation), `${file}: declare audit coverage for ${operation}`);
    }
  }
  assert.ok(auditCoverage.authRoutes.recorded.includes('GET /verify-email'));
});
