import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import pool from '../config/db.js';

try {
  await pool.query(await readFile(new URL('../database/migrations/045_receipt_images.sql', import.meta.url), 'utf8'));
  const result = await pool.query(`SELECT COUNT(DISTINCT payment_submission_id)::int AS payments,
    COUNT(*)::int AS images FROM payment_receipt_images`);
  console.log('Receipt image storage is ready:', result.rows[0]);
} catch (error) {
  console.error('Receipt image migration failed:', error.message);
  process.exitCode = 1;
} finally { await pool.end(); }
