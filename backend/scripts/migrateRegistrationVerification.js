import { readFile } from 'node:fs/promises';
import pg from 'pg';
import pool from '../config/db.js';
// Schema maintenance uses a direct connection; never change session settings on the application pooler.
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
if (url) url.hostname = url.hostname.replace('-pooler.', '.');
const client = new pg.Client(url ? { connectionString: url.toString(), ssl: pool.options.ssl, connectionTimeoutMillis: 10000 } : pool.options);
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query(await readFile(new URL('../database/migrations/039_registration_email_otp.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  console.log('Registration OTP tables ready. Existing accounts unchanged.');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Registration OTP migration failed:', error.message);
  process.exitCode = 1;
} finally { await client.end(); await pool.end(); }
