import { readFile } from 'node:fs/promises';
import pool from '../config/db.js';

try {
  const sql = await readFile(new URL('../database/migrations/048_login_verification.sql', import.meta.url), 'utf8');
  await pool.query(sql);
  console.log('Sign-in verification tables ready.');
} catch (error) {
  console.error('Sign-in verification migration failed:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
