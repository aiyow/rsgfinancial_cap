-- Operational download artifacts only. No plaintext PDF or recoverable password.
CREATE TABLE IF NOT EXISTS soa_exports (
  id UUID PRIMARY KEY,
  export_reference VARCHAR(32) NOT NULL UNIQUE,
  resident_id BIGINT NOT NULL,
  unit_bill_id BIGINT NOT NULL,
  soa_revision INTEGER NOT NULL,
  content_fingerprint CHAR(64) NOT NULL,
  recipient_email VARCHAR(255) NOT NULL,
  idempotency_key UUID NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('PREPARING','EMAIL_PENDING','READY','FAILED','EXPIRED')),
  encrypted_pdf BYTEA,
  failure_code VARCHAR(40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ready_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  UNIQUE (resident_id, idempotency_key),
  CHECK (encrypted_pdf IS NULL OR octet_length(encrypted_pdf) <= 10485760),
  CHECK (status NOT IN ('FAILED','EXPIRED') OR encrypted_pdf IS NULL)
);
-- IDs deliberately survive deletion of the originating account/statement.
CREATE INDEX IF NOT EXISTS soa_exports_cleanup_idx ON soa_exports (status, created_at);
CREATE INDEX IF NOT EXISTS soa_exports_expiry_idx ON soa_exports (expires_at) WHERE status='READY';
CREATE INDEX IF NOT EXISTS soa_exports_retention_idx ON soa_exports (created_at);
CREATE TABLE IF NOT EXISTS soa_export_rate_events (
  export_id UUID PRIMARY KEY,
  resident_id BIGINT NOT NULL,
  ip_hash CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS soa_export_rate_resident_idx ON soa_export_rate_events (resident_id, created_at);
CREATE INDEX IF NOT EXISTS soa_export_rate_ip_idx ON soa_export_rate_events (ip_hash, created_at);
