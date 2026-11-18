-- Copy the payer used by SOA generation once. Future account/assignment changes
-- must never overwrite an Admin-maintained statement name, including empty units.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'units'
      AND column_name = 'soa_resident_name'
  ) THEN
    ALTER TABLE units ADD COLUMN soa_resident_name VARCHAR(205);
    UPDATE units u SET soa_resident_name = (
      SELECT usr.full_name FROM unit_assignments a
      JOIN users usr ON usr.id = a.user_id
      WHERE a.unit_id = u.id AND a.end_date IS NULL
      ORDER BY a.is_primary_payer DESC, a.id LIMIT 1
    );
  END IF;
END $$;
