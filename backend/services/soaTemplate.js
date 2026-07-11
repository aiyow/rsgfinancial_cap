export const defaultSoaTemplate = {
  companyName: "THE RESIDENS CONDOMINIUM CORPORATION",
  companyAddress: "360 Ramon Magsaysay Blvd., Zone 064 Brgy 632, Sta Mesa, Manila 1016",
  statementTitle: "STATEMENT OF ACCOUNT",
  paymentChannel: "GCASH",
  paymentAccountName: "MADELYN JAMBALOS",
  paymentAccountNumber: "0908 674 2196",
  preparedByName: "JERRY BOY CRISPE",
  preparedByTitle: "BILLING ASSOCIATE",
  checkedByName: "MARIQUT B. RIVERA",
  checkedByTitle: "BUILDING ADMIN",
  noticeLine1: "This temporary arrangement will remain in place until the defunct Board of Trustees formally turn over",
  noticeLine2: "our Official Bank Passbook and Cheque book to the Elected Board of Trustees.",
  footerText: "T H A N K   Y O U!",
};

export async function ensureSoaTemplateSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS soa_templates (
      id SMALLINT PRIMARY KEY DEFAULT 1,
      template_data JSONB NOT NULL,
      updated_by BIGINT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT soa_templates_singleton_check CHECK (id = 1)
    )
  `);
  await client.query("ALTER TABLE unit_bills ADD COLUMN IF NOT EXISTS soa_template_snapshot JSONB NULL");
}

export async function ensureSoaTemplate(client) {
  await ensureSoaTemplateSchema(client);
  const result = await client.query(
    `INSERT INTO soa_templates (id, template_data)
     VALUES (1, $1::jsonb)
     ON CONFLICT (id) DO NOTHING
     RETURNING template_data AS "templateData"`,
    [JSON.stringify(defaultSoaTemplate)],
  );
  if (result.rows[0]) return result.rows[0].templateData;
  const existing = await client.query("SELECT template_data AS \"templateData\" FROM soa_templates WHERE id = 1");
  return existing.rows[0]?.templateData || defaultSoaTemplate;
}

export function normalizeSoaTemplate(value = {}) {
  return { ...defaultSoaTemplate, ...(value || {}) };
}
