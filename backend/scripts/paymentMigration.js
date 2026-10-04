import pg from 'pg';
import dotenv from 'dotenv';
import { readFile } from 'node:fs/promises';

dotenv.config({ path: new URL('../.env', import.meta.url) });
const activate = process.argv.includes('--activate');
if (!activate && !process.argv.includes('--check')) throw new Error('Use --check (rolled back) or --activate.');
const connection = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
const url = connection ? new URL(connection) : null;
if (url) url.hostname = url.hostname.replace('-pooler.', '.');
const client = new pg.Client(url ? { connectionString: url.toString(), ...(process.env.DB_SSL === 'true' ? { ssl: { rejectUnauthorized: false } } : {}) }
  : { host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, port: Number(process.env.DB_PORT) });
try {
  await client.connect();
  let sql = await readFile(new URL('../database/migrations/033_category_payment_ledger.sql', import.meta.url), 'utf8');
  if (!activate) sql = sql.replace(/COMMIT;\s*$/, 'ROLLBACK;');
  await client.query(sql);
  console.log(activate ? 'Category payment policy activated. Bills retained; penalty changes audited.' : 'Migration validated on the current database and rolled back. No records or schema changed.');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Payment migration failed:', error.message); process.exitCode = 1;
} finally { await client.end(); }
