BEGIN;

CREATE TABLE IF NOT EXISTS analytics_import_workbooks (
  billing_period_id BIGINT PRIMARY KEY REFERENCES billing_periods(id) ON DELETE CASCADE,
  original_name VARCHAR(255) NOT NULL,
  workbook_data BYTEA NOT NULL CHECK (octet_length(workbook_data) BETWEEN 1 AND 5242880),
  uploaded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE analytics_import_workbooks IS 'Original confirmed water-history workbooks. Older imports can be exported from saved readings.';

COMMIT;
