-- One database-generated OR per approved payment transaction, including combined payments.
-- Existing approved transactions receive the same deterministic ID-based numbering.
ALTER TABLE public.payment_submissions
  ADD COLUMN IF NOT EXISTS official_receipt_no TEXT GENERATED ALWAYS AS (
    CASE WHEN review_status = 'APPROVED'
      THEN 'OR-' || LPAD(id::text, GREATEST(10, LENGTH(id::text)), '0')
      ELSE NULL END
  ) STORED;
CREATE UNIQUE INDEX IF NOT EXISTS payment_submissions_official_receipt_unique
  ON public.payment_submissions(official_receipt_no) WHERE official_receipt_no IS NOT NULL;
