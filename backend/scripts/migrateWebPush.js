import { readFile } from 'node:fs/promises';
import pool from '../config/db.js';

try {
  const sql = await readFile(new URL('../database/migrations/044_web_push.sql', import.meta.url), 'utf8');
  await pool.query(`BEGIN; SET LOCAL lock_timeout = '5s'; ${sql} COMMIT;`);
  console.log('Web Push subscriptions and delivery queue are ready.');
} catch (error) {
  console.error('Web Push migration failed:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
