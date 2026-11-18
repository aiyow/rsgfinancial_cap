import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import pool from '../config/db.js';

try {
  await pool.query(await readFile(new URL('../database/migrations/046_unit_soa_resident_names.sql', import.meta.url), 'utf8'));
  console.log('Unit SOA names are ready. Existing statements have not been changed.');
} catch (error) {
  console.error('Unit SOA name migration failed:', error.message);
  process.exitCode = 1;
} finally { await pool.end(); }
