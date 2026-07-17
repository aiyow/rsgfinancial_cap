const CONFLICT_MESSAGES = {
  users_email_lower_unique: "That email address is already registered.",
  units_unit_number_lower_unique: "That unit number already exists.",
  unit_assignments_unique_assignment: "That assignment already exists for the selected start date.",
  unit_assignments_active_user_unit_unique: "The resident already has an active assignment for this unit.",
  unit_assignments_active_primary_payer_unique: "This unit already has an active primary payer.",
  billing_periods_start_unique: "A billing period already starts on that date.",
  meter_readings_unit_period_unique: "That unit already has a reading for this billing period.",
  unit_bills_unit_period_unique: "That unit already has a bill for this billing period.",
  payment_submissions_receipt_hash_unique: "That receipt image was already submitted.",
  payment_submissions_approved_reference_unique: "That payment reference number was already approved.",
};

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  if (error.code === "CLOUDINARY_NOT_CONFIGURED") {
    return res.status(503).json({ message: error.message });
  }

  if (error.name === "MulterError" || ["Only .xlsx files are accepted.", "Only JPG and PNG receipt images are accepted."].includes(error.message)) {
    return res.status(400).json({ message: error.message });
  }

  if (error.code === "23505") {
    return res.status(409).json({
      message: CONFLICT_MESSAGES[error.constraint] || "A record with those details already exists.",
    });
  }

  if (error.code === "23503") {
    return res.status(409).json({
      message: "This record is referenced by another record and cannot be changed or deleted.",
    });
  }

  if (["23514", "22P02", "22007", "22008"].includes(error.code)) {
    return res.status(400).json({ message: "The submitted data is invalid." });
  }

  console.error(error);
  return res.status(500).json({ message: "An unexpected server error occurred." });
}

export default errorHandler;
