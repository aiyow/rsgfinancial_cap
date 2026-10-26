-- Keep approval-only issuance and the existing API/database field names.
-- Recalculate existing OR identifiers as REF plus the full ID, padded to seven digits.
-- No receipt/OCR/bank reference, payment amount or ledger allocation is changed.
ALTER TABLE public.payment_submissions
  DROP COLUMN IF EXISTS official_receipt_no,
  ADD COLUMN official_receipt_no TEXT GENERATED ALWAYS AS (
    CASE WHEN review_status = 'APPROVED'
      THEN 'REF-' || LPAD(id::text, GREATEST(7, LENGTH(id::text)), '0')
      ELSE NULL END
  ) STORED;

CREATE UNIQUE INDEX payment_submissions_official_receipt_unique
  ON public.payment_submissions(official_receipt_no) WHERE official_receipt_no IS NOT NULL;
