BEGIN;

ALTER TABLE payment_submissions
  ADD COLUMN IF NOT EXISTS ocr_status TEXT CHECK (ocr_status IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED')),
  ADD COLUMN IF NOT EXISTS ocr_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ocr_available_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ocr_claim_token UUID;

CREATE INDEX IF NOT EXISTS payment_submissions_ocr_queue_idx
  ON payment_submissions (ocr_available_at, id)
  WHERE ocr_status IN ('QUEUED', 'PROCESSING');

COMMIT;
