import { readFile } from 'node:fs/promises';
import pg from 'pg';
import pool from '../config/db.js';
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
if (url) url.hostname = url.hostname.replace('-pooler.', '.');
const client = new pg.Client(url ? { connectionString: url.toString(), ssl: pool.options.ssl, connectionTimeoutMillis: 10000 } : pool.options);
try {
  await client.connect(); await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query('LOCK TABLE public.audit_logs IN ACCESS EXCLUSIVE MODE');
  const before = (await client.query("SELECT md5(COALESCE(jsonb_agg(to_jsonb(a)-'context' ORDER BY id)::text,'[]')) AS value FROM public.audit_logs a")).rows[0].value;
  await client.query(await readFile(new URL('../database/migrations/042_detailed_audit_logs.sql', import.meta.url), 'utf8'));
  const after = (await client.query("SELECT md5(COALESCE(jsonb_agg(to_jsonb(a)-'context' ORDER BY id)::text,'[]')) AS value FROM public.audit_logs a")).rows[0].value;
  if (before !== after) throw new Error('Existing audit entries changed; rolling back.');
  await client.query('COMMIT'); console.log('Detailed audit storage ready. Existing audit history preserved.');
} catch (error) { await client.query('ROLLBACK').catch(() => {}); console.error(error.message); process.exitCode = 1; }
finally { await client.end(); await pool.end(); }
