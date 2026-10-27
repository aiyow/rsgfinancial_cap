import { readFile } from 'node:fs/promises';
import pool from '../config/db.js';
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query(await readFile(new URL('../database/migrations/043_protected_soa_exports.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  console.log('Protected SOA export storage ready. Existing statements and audit history were not changed.');
} catch { await client.query('ROLLBACK').catch(() => {}); console.error('Protected SOA migration failed; exports must remain disabled.'); process.exitCode = 1; }
finally { client.release(); await pool.end(); }
