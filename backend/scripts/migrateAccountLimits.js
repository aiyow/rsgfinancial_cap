import { readFile } from 'node:fs/promises';
import pool from '../config/db.js';
try {
  const sql = await readFile(new URL('../database/migrations/038_expand_account_names.sql', import.meta.url), 'utf8');
  await pool.query(sql);
  console.log('Account name storage expanded to 205 characters. Existing records retained.');
} catch (error) {
  console.error('Account name migration failed:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
