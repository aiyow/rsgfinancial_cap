import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import pool from '../config/db.js';

try {
  await pool.query(await readFile(new URL('../database/migrations/047_background_receipt_ocr.sql', import.meta.url), 'utf8'));
  console.log('Background receipt OCR schema is ready.');
} catch (error) {
  console.error('Background receipt OCR migration failed:', error.message);
  process.exitCode = 1;
} finally { await pool.end(); }
