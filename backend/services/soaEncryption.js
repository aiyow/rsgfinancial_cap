import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, readdir, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const tempRoot = join(tmpdir(), 'residens-protected-soa');
const activeDirectories = new Set();

// qpdf receives only @- in argv. Its complete argument list, including secrets,
// is written to its private stdin pipe. Stderr is deliberately never exposed.
export function runQpdf(argumentsList, { binary = process.env.QPDF_PATH || 'qpdf', maxBytes = 12 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['@-'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    const chunks = []; let size = 0;
    const timeout = setTimeout(() => child.kill(), 30000);
    child.stdout.on('data', chunk => { size += chunk.length; if (size > maxBytes) child.kill(); else chunks.push(chunk); });
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.once('error', () => { clearTimeout(timeout); reject(new Error('PDF_ENCRYPTION_UNAVAILABLE')); });
    child.once('close', code => {
      clearTimeout(timeout);
      if (code !== 0 || size > maxBytes) reject(new Error('PDF_ENCRYPTION_FAILED'));
      else resolve(Buffer.concat(chunks));
    });
    const input = Buffer.from(argumentsList.join('\n') + '\n');
    child.stdin.end(input, () => input.fill(0));
  });
}

export async function cleanupSoaTemporaryFiles() {
  await mkdir(tempRoot, { recursive: true, mode: 0o700 });
  if ((await lstat(tempRoot)).isSymbolicLink()) throw new Error('UNSAFE_PDF_TEMP_DIRECTORY');
  for (const name of await readdir(tempRoot)) {
    if (!/^job-[A-Za-z0-9]+$/.test(name)) continue;
    const path = join(tempRoot, name), stat = await lstat(path);
    if (!stat.isSymbolicLink() && stat.isDirectory() && !activeDirectories.has(path) && stat.mtimeMs < Date.now() - 300000) {
      await rm(path, { recursive: true, force: true });
    }
  }
}

export async function encryptSoaPdf(plaintext, password, { binary } = {}) {
  await mkdir(tempRoot, { recursive: true, mode: 0o700 });
  if ((await lstat(tempRoot)).isSymbolicLink()) throw new Error('UNSAFE_PDF_TEMP_DIRECTORY');
  const directory = await mkdtemp(join(tempRoot, 'job-'));
  activeDirectories.add(directory);
  const input = join(directory, 'statement.pdf'), encryptedPath = join(directory, 'protected.pdf');
  let owner = randomBytes(48).toString('base64url');
  try {
    await writeFile(input, plaintext, { mode: 0o600, flag: 'wx' });
    const encrypted = await runQpdf([input, '--encrypt', password, owner, '256', '--print=full', '--', '-'], { binary });
    await writeFile(encryptedPath, encrypted, { mode: 0o600, flag: 'wx' });
    const inspection = (await runQpdf([`--password=${password}`, '--show-encryption', encryptedPath], { binary })).toString();
    if (!/R = 6\b/.test(inspection) || !/stream encryption method: AESv3/.test(inspection) || !/string encryption method: AESv3/.test(inspection)) throw new Error('PDF_ENCRYPTION_INVALID');
    // Even with a correct encryption dictionary an empty opening password is unsafe.
    let opensWithoutPassword = false;
    try { await runQpdf(['--password=', '--check', encryptedPath], { binary }); opensWithoutPassword = true; } catch { /* expected */ }
    if (opensWithoutPassword) throw new Error('PDF_OPENING_PASSWORD_REQUIRED');
    return encrypted;
  } finally {
    owner = null;
    activeDirectories.delete(directory);
    await rm(directory, { recursive: true, force: true });
  }
}
