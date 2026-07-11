BEGIN;

CREATE TABLE IF NOT EXISTS soa_templates (
    id SMALLINT PRIMARY KEY DEFAULT 1,
    template_data JSONB NOT NULL,
    updated_by BIGINT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT soa_templates_singleton_check CHECK (id = 1),
    CONSTRAINT soa_templates_updated_by_fk
      FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO soa_templates (id, template_data)
VALUES (1, '{
  "companyName": "THE RESIDENS CONDOMINIUM CORPORATION",
  "companyAddress": "360 Ramon Magsaysay Blvd., Zone 064 Brgy 632, Sta Mesa, Manila 1016",
  "statementTitle": "STATEMENT OF ACCOUNT",
  "paymentChannel": "GCASH",
  "paymentAccountName": "MADELYN JAMBALOS",
  "paymentAccountNumber": "0908 674 2196",
  "preparedByName": "JERRY BOY CRISPE",
  "preparedByTitle": "BILLING ASSOCIATE",
  "checkedByName": "MARIQUT B. RIVERA",
  "checkedByTitle": "BUILDING ADMIN",
  "noticeLine1": "This temporary arrangement will remain in place until the defunct Board of Trustees formally turn over",
  "noticeLine2": "our Official Bank Passbook and Cheque book to the Elected Board of Trustees.",
  "footerText": "T H A N K   Y O U!"
}'::jsonb)
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS soa_templates_set_updated_at ON soa_templates;
CREATE TRIGGER soa_templates_set_updated_at
BEFORE UPDATE ON soa_templates
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE unit_bills
ADD COLUMN IF NOT EXISTS soa_template_snapshot JSONB NULL;

COMMIT;
