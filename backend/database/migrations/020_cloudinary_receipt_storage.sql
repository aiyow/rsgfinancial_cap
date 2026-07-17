BEGIN;

ALTER TABLE payment_submissions
  ADD COLUMN IF NOT EXISTS receipt_storage VARCHAR(20) NOT NULL DEFAULT 'LOCAL',
  ADD COLUMN IF NOT EXISTS receipt_cloudinary_public_id TEXT NULL;

ALTER TABLE payment_submissions
  DROP CONSTRAINT IF EXISTS payment_submissions_receipt_storage_check;

ALTER TABLE payment_submissions
  ADD CONSTRAINT payment_submissions_receipt_storage_check
  CHECK (
    (receipt_storage = 'LOCAL' AND receipt_cloudinary_public_id IS NULL)
    OR (receipt_storage = 'CLOUDINARY' AND receipt_cloudinary_public_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS payment_submissions_cloudinary_public_id_idx
  ON payment_submissions(receipt_cloudinary_public_id)
  WHERE receipt_cloudinary_public_id IS NOT NULL;

COMMIT;
