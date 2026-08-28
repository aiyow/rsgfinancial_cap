# Backend Code Guide

This guide covers every application-owned JavaScript file under `backend`, excluding `node_modules`. It includes the Express server, middleware, routes, services, maintenance scripts, and automated tests.

## Server and middleware

### `backend/server.js`

- **Purpose:** Creates and starts the Express API.
- **Exports/logic:** Configures CORS and JSON parsing, registers all `/api/*` routers, exposes `/` and `/api/health`, returns a JSON 404, and sends failures to `errorHandler`.
- **API/data:** Uses the PostgreSQL pool for the health query; listens on `PORT` or 5000.
- **Role/usage:** All roles through the HTTP API. Route modules enforce the actual permissions.

### `backend/config/db.js`

- **Purpose:** Creates the PostgreSQL `pg.Pool` from `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`.
- **Exports/logic:** Default-exports the pool used by routes/services/scripts.
- **API/data:** Database only.
- **Role/usage:** Shared backend infrastructure.

### `backend/middleware/authMiddleware.js`

- **Purpose:** JWT authentication and role authorization.
- **Exports/logic:** `requireAuth` parses/verifies the bearer token and attaches the user to `req.user`; `allowRoles(...roles)` rejects users outside the listed role set.
- **API/data:** Reads `JWT_SECRET`; queries/uses user identity as required by routes.
- **Role/usage:** Applied by protected routes; authorization must not rely only on frontend guards.

### `backend/middleware/validate.js`

- **Purpose:** Shared request validation helpers.
- **Exports/logic:** `validateBody(schema)` parses `req.body` with Zod and returns a client error for invalid input; `requireId` validates numeric path IDs.
- **API/data:** No external calls.
- **Role/usage:** Used in route definitions before database work.

### `backend/middleware/errorHandler.js`

- **Purpose:** Converts thrown route/service errors into consistent HTTP responses.
- **Exports/logic:** Maps known PostgreSQL conflicts and validation/application errors to status codes/messages; logs unexpected failures and returns a safe response.
- **API/data:** Reads database error metadata but does not query the database.
- **Role/usage:** Final Express middleware for all roles.

## Route modules

All route files export an Express router. `server.js` mounts them at the base paths below. They combine role middleware, Zod validation, SQL, and services.

### `backend/routes/authRoutes.js` — `/api/auth`

- `POST /register`: validates and creates a development account.
- `POST /login`: verifies a password with bcrypt and returns a JWT/user payload.
- `GET /me`: returns the authenticated user.
- **Roles:** Registration is public; `/me` requires authentication.
- **Data/services:** `users` table, bcrypt, JWT, and audit-related account behavior.

### `backend/routes/userRoutes.js` — `/api/users`

- `GET /`, `GET /:id`: list or fetch user records.
- `POST /`: create a user with validated role/profile data.
- `PATCH /:id`: update profile, password, role, or active state according to route rules.
- `DELETE /:id`: permanently remove an allowed account and related assignment records.
- **Roles:** Intended for Admin management; route-level checks and current-user safeguards apply in the implementation.
- **Data/services:** `users`, bcrypt, assignments, and audit logging.

### `backend/routes/unitRoutes.js` — `/api/units`

- `GET /`, `GET /:id`: return units with occupancy/balance context.
- `POST /`: create a unit.
- `PATCH /:id`: update unit number, floor, area, or occupancy fields.
- `DELETE /:id`: remove a unit when database constraints permit.
- **Roles:** Reads for ADMIN/COLLECTOR/RESIDENT; writes for ADMIN.
- **Data/services:** `units`, assignment, bill, and payment joins.

### `backend/routes/unitAssignmentRoutes.js` — `/api/unit-assignments`

- `GET /`, `GET /:id`: list or fetch assignments filtered by visibility.
- `POST /`: assign a resident as owner/tenant and optionally primary payer.
- `PATCH /:id`: update assignment details.
- `DELETE /:id`: end an assignment.
- **Roles:** Reads for all authenticated roles; writes for ADMIN.
- **Data/services:** Assignment and user/unit tables; audit events.

### `backend/routes/billingPeriodRoutes.js` — `/api/billing-periods`

- `GET /`: list periods visible to Admin/Collector.
- `POST /`, `PATCH /:id`: create/update a Collector draft period.
- `POST /:id/readings/preview`: parse and validate an uploaded workbook.
- `GET /:id/readings`, `PUT /:id/readings`: inspect/save normalized meter readings.
- `POST /:id/generate`: calculate and create live bills/SOAs.
- `POST /:id/reopen`: reopen an eligible batch.
- `POST /:id/forward`: forward a Collector batch to Admin.
- `POST /:id/publish`: Admin publishes selected bills and triggers SOA deliveries.
- `POST /:id/bills/:billId/email-deliveries/retry|resend`: retry or force a SOA email.
- `DELETE /:id`: delete an eligible Collector batch.
- **Roles:** Collector owns draft/generation/forwarding; Admin owns publication and delivery recovery.
- **Data/services:** Billing periods, readings, bills, SOA template/email delivery, analytics generation, audit logs, workbook compatibility, and meter validation.

### `backend/routes/billRoutes.js` — `/api/bills`

- `GET /`: list bills filtered by role, period, status, or unit.
- `GET /:id`: return one bill with SOA/payment context.
- `PATCH /:id`: allow a Collector to edit eligible, unforwarded bill fields.
- **Roles:** Read visibility is role-filtered; edits are Collector-only.
- **Data/services:** Bills, units, assignments, payment ledger, SOA template, and late-penalty calculations.

### `backend/routes/paymentRoutes.js` — `/api/payments`

- `POST /bills/:id/preview`: resident receipt upload preview/OCR validation.
- `POST /bills/:id`: final resident receipt submission.
- `GET /credits`: Admin/resident credit balances.
- `POST /manual`: Admin records a manual, face-to-face, or advance payment.
- `GET /`, `GET /:id`: role-filtered payment list/detail.
- `GET /:id/receipt`: streams the private receipt through authentication.
- `POST /:id/review`: Admin approves/rejects and allocates a payment.
- `DELETE /:id`: Admin removes an eligible payment record.
- **Roles:** Residents submit; Admin reviews/manual-records; Collectors can view allowed approved records.
- **Data/services:** Payment submissions/applications, receipt OCR, Cloudinary/local storage, payment ledger, notifications, and audit logs.

### `backend/routes/auditLogRoutes.js` — `/api/audit-logs`

- `GET /`: Admin-filtered/paginated audit history.
- **Roles:** ADMIN.
- **Data/services:** `audit_logs` table and query filters.

### `backend/routes/analyticsImportRoutes.js` — `/api/analytics/imports`

- `GET /`: list imported historical periods.
- `POST /preview`: parse/validate a historical workbook without committing it.
- `POST /`: save historical analytics rows.
- `DELETE /:periodMonth`, `DELETE /`: remove one or all imported historical periods.
- **Roles:** Collector workflow, with route checks on authenticated staff access.
- **Data/services:** ExcelJS/workbook compatibility, historical analytics tables, reading validation, and audit behavior.

### `backend/routes/analyticsRoutes.js` — `/api/analytics`

- `GET /resident`: assigned-unit analytics for a Resident.
- `GET /overview`: aggregate Admin/Collector dashboard analytics.
- `GET /units/:id`: staff analytics for one unit.
- **Roles:** Resident endpoint is resident-only; overview/unit endpoints are staff-only.
- **Data/services:** Historical/live readings, predictive forecasting, accuracy calculations, and recommendation context.

### `backend/routes/prescriptiveRecommendationRoutes.js` — `/api/prescriptive-recommendations`

- `GET /resident`: resident-visible recommendations for assigned units.
- `PATCH /:id/view`: resident marks their recommendation viewed.
- `GET /`: Admin/Collector recommendation list.
- `DELETE /:id`: Admin/Collector permanently delete a recommendation.
- **Data/services:** `prescriptiveAnalytics.js`, recommendation table, assignments, and audit logs.

### `backend/routes/soaTemplateRoutes.js` — `/api/soa-template`

- `GET /`: Admin/Collector reads the normalized template.
- `PATCH /`: Collector saves future SOA text/branding fields.
- **Data/services:** SOA template table and `soaTemplate.js` normalization.

### `backend/routes/dashboardRoutes.js` — `/api/dashboard`

- `GET /overview`: returns operational counts, balances, recent activity, and role-filtered dashboard data.
- **Roles:** Authenticated users; returned fields are visibility-filtered.
- **Data/services:** Units, bills, payments, periods, and notification/analytics summaries.

### `backend/routes/notificationRoutes.js` — `/api/notifications`

- `GET /`: list the current user's notifications.
- `PATCH /read-all`: mark all current-user notifications read.
- `PATCH /:id/read`: mark one notification read after ownership checking.
- **Roles:** Authenticated users; records are user-scoped.
- **Data/services:** Notifications table/service.

## Services

### `backend/services/paymentLedger.js`

Calculates late penalties, bill totals, applied amounts, credit allocation, and manual payment references. Its SQL fragments and allocation logic keep `payment_submissions` (the submitted payment) separate from `payment_applications` (the accounting allocation). Tested by `paymentLedger.test.js`.

### `backend/services/meterReadingValidation.js`

Validates previous/current/preceding cumulative readings, detects negative consumption and continuity problems, and produces flags used by live and historical workbook imports. Tested by `meterReadingValidation.test.js`.

### `backend/services/predictiveAnalytics.js`

Selects a five-month consecutive history window, computes linear regression, predicts the next month, compares predictions with actuals where available, and returns forecast/accuracy metadata. Tested by `predictiveAnalytics.test.js`.

### `backend/services/prescriptiveAnalytics.js`

Defines recommendation types and thresholds, then converts history/forecast/context into explainable recommendations such as rising consumption, vacant-unit usage, payment reminders, high usage, or monitoring. Tested by `prescriptiveAnalytics.test.js`.

### `backend/services/receiptOcr.js`

Preprocesses receipt images and uses Tesseract to extract amount/date/reference text and quality signals. Payment routes use it during preview/submission so Admin receives OCR assistance without treating OCR as final accounting truth.

### `backend/services/cloudinaryReceipts.js`

Creates the private Cloudinary receipt service, uploads authenticated image assets, creates delivery URLs for server-side streaming, and destroys assets when records are removed. Tested by `cloudinaryReceipts.test.js`.

### `backend/services/soaTemplate.js`

Defines default SOA fields and `normalizeSoaTemplate`, ensuring generated statements have safe, complete display values.

### `backend/services/soaEmail.js`

Builds an SOA email message and creates a Nodemailer transport from SMTP environment settings. Tested by `soaEmail.test.js`.

### `backend/services/soaEmailDeliveries.js`

Records delivery attempts/status, sends or retries delivery, and supports Admin-visible pending/failed/sent counts for a bill or batch.

### `backend/services/notifications.js`

Creates and retrieves in-app notifications, including user-scoped unread state used by `NotificationCenter`.

### `backend/services/auditLog.js`

Writes audit entries for significant account, billing, publication, payment, and recommendation actions. Routes pass actor/target/action metadata so Admin can review history.

### `backend/services/workbookCompatibility.js`

Normalizes workbook headers/values and checks supported Excel input formats. Billing and historical-import routes use it before validation and persistence.

## Maintenance scripts

### `backend/scripts/initDatabase.js`

Creates the base schema and applies numbered migrations in order. Intended for a fresh/disposable database; back up an existing database before using it.

### `backend/scripts/seedUsers.js`

Reads configured Admin/Collector credentials, hashes passwords with bcrypt, and inserts duplicate-safe initial accounts.

### `backend/scripts/importHistoricalAnalytics.js`

Command-line importer for historical workbook data. It parses/validates months and readings, then writes `HISTORICAL_ANALYTICS` records used by forecast generation.

### `backend/scripts/migrateLocalReceiptsToCloudinary.js`

Finds local payment-proof files, supports a dry run, uploads them to Cloudinary, updates receipt metadata, and preserves local files as a rollback copy until verification.

## Automated tests

Tests use Node's built-in test runner and focus on deterministic services without requiring the whole server:

| File | Verifies |
|---|---|
| `cloudinaryReceipts.test.js` | Upload/destroy configuration and private receipt service behavior. |
| `meterReadingValidation.test.js` | Valid readings, negative consumption, continuity, and flagged cases. |
| `paymentLedger.test.js` | Penalties, bill totals, credits, allocation, and payment references. |
| `predictiveAnalytics.test.js` | Regression, five-month selection, forecast values, and accuracy handling. |
| `prescriptiveAnalytics.test.js` | Recommendation thresholds, visibility, and monitoring fallbacks. |
| `soaEmail.test.js` | SMTP configuration and generated SOA email message content. |

## Backend developer notes

- Backend secrets belong only in `backend/.env`: database credentials, JWT secret, SMTP credentials, and Cloudinary API secret.
- The frontend must never receive the Cloudinary API secret or a direct private asset credential; receipt access is intentionally proxied through the authenticated API.
- Database writes use migrations in `backend/database/migrations`; adding a field should include a migration and compatible route/service behavior.
- The application has two billing concepts: `LIVE_BILLING` creates real SOAs, while `HISTORICAL_ANALYTICS` supplies forecast history and should not create resident bills.
- Payment approval is accounting-sensitive: the intended target bill is retained on the submission, while actual allocation is represented by payment applications.
- The route files are intentionally thin-to-medium orchestration layers. Put reusable calculations in services so they can be tested independently.
- Run `npm test` from `backend` after changing services, and use the frontend lint/build commands after changing pages or shared components.
