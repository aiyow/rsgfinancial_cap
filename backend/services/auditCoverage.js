// Every new mutation route must declare its audit contract here. Covered routes
// commit a business audit; excluded routes only manipulate temporary or UI state.
export const auditCoverage = {
  accountRoutes: { recorded: ['PATCH /profile', 'POST /email-change/verify'], excluded: ['POST /email-change'] },
  analyticsImportRoutes: { recorded: ['POST /', 'DELETE /:periodMonth', 'DELETE /'], excluded: ['POST /preview'] },
  analyticsRoutes: { recorded: ['POST /refresh-forecasts'] },
  authRoutes: { recorded: ['POST /register', 'POST /reset-password', 'POST /change-password', 'GET /verify-email'], excluded: ['POST /login', 'POST /forgot-password', 'POST /verify-password-reset-otp', 'POST /resend-verification'] },
  registrationRoutes: { excluded: ['POST /register/send-otp', 'POST /register/verify-otp'] },
  billingErrorRoutes: { recorded: ['POST /bills/:id', 'PATCH /:id/resolve'] },
  billingPeriodRoutes: { recorded: ['POST /', 'PATCH /:id', 'PUT /:id/readings', 'POST /:id/generate', 'POST /:id/reopen', 'POST /:id/forward', 'POST /:id/publish', 'POST /:id/unpublish', 'POST /:id/bills/:billId/unpublish', 'POST /:id/bills/:billId/email-deliveries/retry', 'POST /:id/bills/:billId/email-deliveries/resend', 'DELETE /:id'], excluded: ['POST /:id/readings/preview'] },
  billRoutes: { recorded: ['PATCH /:id/payment-references', 'PATCH /:id'] },
  notificationRoutes: { excluded: ['PATCH /read-all', 'PATCH /:id/read'] },
  paymentRoutes: { recorded: ['POST /bills/:id', 'POST /manual', 'PATCH /:id/invoice-references', 'POST /:id/review', 'DELETE /:id'], excluded: ['POST /bills/:id/preview', 'POST /allocation-preview'] },
  prescriptiveRecommendationRoutes: { recorded: ['PATCH /:id/view', 'DELETE /:id'] },
  soaTemplateRoutes: { recorded: ['PATCH /', 'POST /assets/:type'] },
  userRoutes: { recorded: ['POST /', 'PATCH /:id', 'DELETE /:id'] },
  unitRoutes: { recorded: ['POST /', 'PATCH /:id', 'DELETE /:id'] },
  unitAssignmentRoutes: { recorded: ['POST /', 'PATCH /:id', 'DELETE /:id'] },
};
