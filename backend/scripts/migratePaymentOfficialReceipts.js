import { readFile } from 'node:fs/promises';
import pg from 'pg';
import pool from '../config/db.js';
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
if (url) url.hostname = url.hostname.replace('-pooler.', '.');
const client = new pg.Client(url ? { connectionString:url.toString(),ssl:pool.options.ssl,connectionTimeoutMillis:10000 } : pool.options);
const fingerprint = async () => (await client.query(`SELECT md5(COALESCE(jsonb_agg(to_jsonb(p)-'official_receipt_no' ORDER BY p.id)::text,'[]')) AS value FROM public.payment_submissions p`)).rows[0].value;
try {
  await client.connect();await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query('LOCK TABLE public.payment_submissions IN ACCESS EXCLUSIVE MODE');
  const before=await fingerprint();
  await client.query(await readFile(new URL('../database/migrations/040_payment_official_receipts.sql',import.meta.url),'utf8'));
  await client.query(await readFile(new URL('../database/migrations/041_payment_reference_format.sql',import.meta.url),'utf8'));
  if(await fingerprint()!==before)throw new Error('Existing payment data changed unexpectedly; migration rolled back.');
  const result=await client.query(`SELECT COUNT(*) FILTER(WHERE review_status='APPROVED')::int AS approved,
    COUNT(official_receipt_no)::int AS receipts, COUNT(DISTINCT official_receipt_no)::int AS unique_receipts,
    COUNT(*) FILTER(WHERE official_receipt_no IS DISTINCT FROM
      CASE WHEN review_status='APPROVED' THEN 'REF-' || LPAD(id::text,GREATEST(7,LENGTH(id::text)),'0') ELSE NULL END)::int AS invalid
    FROM public.payment_submissions`);
  const row=result.rows[0];if(row.approved!==row.receipts||row.receipts!==row.unique_receipts||row.invalid)throw new Error('Reference numbering validation failed.');
  await client.query('COMMIT');console.log('Payment REF numbers ready:',row,'Existing payment and receipt reference data preserved.');
} catch(error) {await client.query('ROLLBACK').catch(()=>{});console.error('Reference migration failed:',error.message);process.exitCode=1;}
finally{await client.end();await pool.end();}
