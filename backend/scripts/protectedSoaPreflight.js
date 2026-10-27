import pool from '../config/db.js';
import { createProtectedSoaExportService } from "../services/soa.js";
try {
  await createProtectedSoaExportService({ db: pool, environment: { ...process.env, SOA_PROTECTED_EXPORTS_ENABLED: 'true' } }).ensureReady();
  console.log('Protected SOA preflight passed: migrated storage, encrypted PDF with required opening password, AES-256 R6, and authenticated TLS SMTP. No email was sent.');
} catch { console.error('Protected SOA preflight failed. Check migration, qpdf, fonts/logo, and SMTP TLS/authentication. Keep exports disabled.'); process.exitCode = 1; }
finally { await pool.end(); }
