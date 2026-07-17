import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pool from "../config/db.js";
import { destroyReceipt, uploadReceipt } from "../services/cloudinaryReceipts.js";

const dryRun = process.argv.includes("--dry-run");
const uploadDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../uploads/payment-proofs");

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function migrateReceipts() {
  const result = await pool.query(
    `SELECT id, receipt_path AS "receiptPath", receipt_mime_type AS "receiptMimeType"
     FROM payment_submissions
     WHERE entry_type = 'RECEIPT_UPLOAD' AND receipt_storage = 'LOCAL'
     ORDER BY id`,
  );

  let migrated = 0;
  let missing = 0;
  let failed = 0;

  for (const receipt of result.rows) {
    const filePath = path.join(uploadDirectory, path.basename(receipt.receiptPath || ""));
    if (!receipt.receiptPath || !await fileExists(filePath)) {
      missing += 1;
      console.warn(`Payment ${receipt.id}: local receipt file is missing (${receipt.receiptPath || "no path"}).`);
      continue;
    }

    if (dryRun) {
      console.log(`Payment ${receipt.id}: ready to migrate ${path.basename(filePath)}.`);
      continue;
    }

    let uploaded;
    try {
      uploaded = await uploadReceipt(await readFile(filePath));
      const updated = await pool.query(
        `UPDATE payment_submissions
         SET receipt_storage = 'CLOUDINARY', receipt_cloudinary_public_id = $2
         WHERE id = $1 AND entry_type = 'RECEIPT_UPLOAD' AND receipt_storage = 'LOCAL'
         RETURNING id`,
        [receipt.id, uploaded.publicId],
      );
      if (!updated.rows[0]) {
        await destroyReceipt(uploaded.publicId);
        console.warn(`Payment ${receipt.id}: skipped because it was changed while migrating.`);
        continue;
      }
      migrated += 1;
      console.log(`Payment ${receipt.id}: migrated to Cloudinary.`);
    } catch (error) {
      failed += 1;
      if (uploaded?.publicId) await destroyReceipt(uploaded.publicId).catch(() => {});
      console.error(`Payment ${receipt.id}: migration failed: ${error.message}`);
    }
  }

  console.log(`Migration complete. Migrated: ${migrated}; missing: ${missing}; failed: ${failed}; dry run: ${dryRun}.`);
  if (missing || failed) process.exitCode = 1;
}

migrateReceipts()
  .catch((error) => {
    console.error(`Receipt migration failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
