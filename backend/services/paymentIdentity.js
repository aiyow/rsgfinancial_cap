// submitted_by identifies the uploader or staff recorder, not necessarily the
// resident whose unit receives a manual payment or advance credit.
export const paymentResidentNameSql = `CASE WHEN ps.entry_type = 'MANUAL' THEN
  COALESCE(NULLIF(BTRIM(b.payer_name_snapshot), ''), (
    SELECT NULLIF(BTRIM(resident.full_name), '')
    FROM unit_assignments assignment
    JOIN users resident ON resident.id = assignment.user_id AND resident.role = 'RESIDENT'
    WHERE assignment.unit_id = ps.unit_id
      AND assignment.start_date <= COALESCE(ps.verified_payment_date, (ps.submitted_at AT TIME ZONE 'Asia/Manila')::date)
      AND (assignment.end_date IS NULL OR assignment.end_date >= COALESCE(ps.verified_payment_date, (ps.submitted_at AT TIME ZONE 'Asia/Manila')::date))
    ORDER BY assignment.is_primary_payer DESC, assignment.start_date DESC, assignment.id DESC
    LIMIT 1
  ), 'Unassigned unit')
ELSE COALESCE(NULLIF(BTRIM(submitter.full_name), ''), 'Deleted resident') END`;
