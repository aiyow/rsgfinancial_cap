# Frontend Code Guide

This guide covers every application-owned `.jsx` and `.js` file under `frontend/src`. Dependency code and generated files are excluded. Each entry explains the file's purpose, important logic, API usage, role, and relationship to the rest of the UI.

## Entry, routing, and services

### `frontend/src/main.jsx`

- **Purpose:** Browser entry point. It mounts the React application into `#root`.
- **Exports/logic:** Wraps `App` in `StrictMode`, `AuthProvider`, and `BrowserRouter` (in the current source composition).
- **API/data:** No direct API calls; authentication is initialized by `AuthProvider`.
- **Role/usage:** All roles. Vite loads this file from `index.html`.

### `frontend/src/App.jsx`

- **Purpose:** Central route table.
- **Exports/logic:** Defines `HomeRedirect` and the default `App` component. It maps public routes (`/login`, `/register`) and role-protected routes to page components.
- **API/data:** Uses `useAuth` and `dashboardPathFor` for the root redirect; pages perform the actual API calls.
- **Role/usage:** All roles. `ProtectedRoute` gates each Admin, Collector, Resident, profile, and settings page.

### `frontend/src/constants/routes.js`

- **Purpose:** Keeps role dashboard URLs in one place.
- **Exports/logic:** `dashboardPathFor(role)` returns the dashboard path for `ADMIN`, `COLLECTOR`, or `RESIDENT`.
- **API/data:** No API calls.
- **Role/usage:** Used by `App.jsx`, login/logout redirects, and any code that needs a role landing page.

### `frontend/src/services/api.js`

- **Purpose:** Shared HTTP client.
- **Exports/logic:** `apiRequest(path, options)` sends JSON or `FormData`, adds the bearer token, parses JSON, and converts failed responses into `Error` objects containing `data` and `status`. `apiFile(path, options)` downloads an authenticated blob such as a payment receipt.
- **API/data:** Uses `VITE_API_URL`, defaulting to `http://localhost:5000`.
- **Role/usage:** All pages and shared components use it. It is the single frontend-to-backend boundary.
- **Developer note:** Verify the current `API_URL` identifier used inside `apiRequest`; the source currently contains an `APIc_URL` reference that does not match the declaration.

## Authentication and shared infrastructure

### `frontend/src/context/auth-context.js`

- **Purpose:** Defines the React authentication context object.
- **Exports/logic:** Exports the context consumed by `AuthProvider` and `useAuth`.
- **API/data:** No direct API calls.
- **Role/usage:** All roles; infrastructure only.

### `frontend/src/context/AuthContext.jsx`

- **Purpose:** Owns the current user, JWT token, initialization state, login, and logout behavior.
- **Exports/logic:** `AuthProvider` restores a saved token, calls `/api/auth/me`, exposes `login`, and removes invalid sessions. Login calls `/api/auth/login` and stores the response.
- **API/data:** `apiRequest('/api/auth/me')` and `apiRequest('/api/auth/login')`; token is persisted in `localStorage`.
- **Role/usage:** All roles; wraps the entire application from `main.jsx`.

### `frontend/src/hooks/useAuth.js`

- **Purpose:** Convenience hook for reading `AuthContext`.
- **Exports/logic:** `useAuth()` returns the context value and provides a single import path for user/token/authentication state.
- **API/data:** No direct API calls.
- **Role/usage:** All pages and guards.

### `frontend/src/components/ProtectedRoute.jsx`

- **Purpose:** Route-level access control.
- **Exports/logic:** `ProtectedRoute` waits for initialization, redirects unauthenticated users to `/login`, and redirects authenticated users whose role does not match `allowedRole` or `allowedRoles`.
- **API/data:** Reads `useAuth`; does not call the API itself.
- **Role/usage:** Used by every protected route in `App.jsx`.

### `frontend/src/components/DashboardLayout.jsx`

- **Purpose:** Shared application shell and reusable panel/table helpers.
- **Exports/logic:** Default `DashboardLayout` renders sidebar navigation, header actions, profile/settings links, notification center, responsive menu, and sign-out. Named `Panel` and `EmptyRow` standardize content sections and empty tables.
- **API/data:** Uses authentication state and renders `NotificationCenter`.
- **Role/usage:** All role pages; navigation items are role-aware.

### `frontend/src/components/BrandMark.jsx`

- **Purpose:** Renders the RSG/Residens visual brand mark.
- **Exports/logic:** `BrandMark({ size })` controls the visual size and uses Lucide building/water icons.
- **API/data:** None.
- **Role/usage:** Login, registration, and shared layout branding.

### `frontend/src/components/NotificationCenter.jsx`

- **Purpose:** Header notification bell and unread notification handling.
- **Exports/logic:** Loads notifications, toggles the popover, marks individual notifications read, and supports mark-all-read.
- **API/data:** `GET /api/notifications`, `PATCH /api/notifications/:id/read`, and `PATCH /api/notifications/read-all`.
- **Role/usage:** All authenticated roles through `DashboardLayout`.

### `frontend/src/components/ReadOnlyRecords.jsx`

- **Purpose:** Reusable read-only unit/assignment record display.
- **Exports/logic:** Loads units and assignments, combines them for a staff or resident view, and renders a consistent table/list.
- **API/data:** `GET /api/units` and `GET /api/unit-assignments`.
- **Role/usage:** Used where users can inspect records without editing them, including Collector unit views.

### `frontend/src/components/SoaDocument.jsx`

- **Purpose:** Printable Statement of Account presentation.
- **Exports/logic:** `SoaDocument({ bill })` formats dates, line items, totals, balances, and template fields for browser printing or PDF saving.
- **API/data:** Receives a fully loaded bill; no direct API calls.
- **Role/usage:** Admin, Collector, and Resident bill detail pages.

## Public pages

### `frontend/src/pages/Login.jsx`

- **Purpose:** Sign-in form.
- **Exports/logic:** Tracks email/password, submits through `login`, displays validation/API errors, and redirects to the role dashboard.
- **API/data:** Indirectly calls `/api/auth/login` through `AuthContext`.
- **Role/usage:** Public.

### `frontend/src/pages/Register.jsx`

- **Purpose:** Development registration form.
- **Exports/logic:** Collects name, email, password, and selected role; creates an account and redirects to login.
- **API/data:** `POST /api/auth/register`.
- **Role/usage:** Public development helper; production systems should restrict role creation.

## Admin pages

### `frontend/src/pages/admin/AdminDashboard.jsx`

- **Purpose:** Admin landing page.
- **Exports/logic:** Thin role wrapper that renders `OperationalDashboard` with `ADMIN`.
- **API/data:** Indirectly uses dashboard/analytics APIs through the shared dashboard.
- **Role/usage:** ADMIN at `/admin`.

### `frontend/src/pages/admin/AdminUsersPage.jsx`

- **Purpose:** Create, edit, activate/deactivate, and delete user accounts.
- **Exports/logic:** Loads users, filters/searches them, maintains an add/edit form, prevents deleting the current user, and refreshes after mutations.
- **API/data:** `GET/POST /api/users`, `PATCH /api/users/:id`, and `DELETE /api/users/:id`.
- **Role/usage:** ADMIN at `/admin/users`.

### `frontend/src/pages/admin/AdminUnitsViewPage.jsx`

- **Purpose:** Read-only overview of unit occupancy and assignments.
- **Exports/logic:** Loads units and assignments and presents an Admin-facing summary without edit controls.
- **API/data:** `GET /api/units` and `GET /api/unit-assignments`.
- **Role/usage:** ADMIN at `/admin/units`.

### `frontend/src/pages/admin/AdminUnitsPage.jsx`

- **Purpose:** Full unit and resident-assignment management screen.
- **Exports/logic:** Loads units, assignments, users, bills, and payments; filters rows; opens create/edit forms; creates assignments; ends assignments; and deletes units after confirmation.
- **API/data:** `/api/units`, `/api/unit-assignments`, `/api/users`, `/api/bills`, and `/api/payments`.
- **Role/usage:** ADMIN at `/admin/units/manage`; `/admin/assignments` redirects here.

### `frontend/src/pages/admin/AdminAssignmentsPage.jsx`

- **Purpose:** Dedicated assignment-management page retained in the source tree.
- **Exports/logic:** Loads selectable units/users, creates assignments, and ends assignments. The current route table redirects `/admin/assignments` to the combined unit-management page.
- **API/data:** `GET/POST /api/unit-assignments`, `GET /api/units`, `GET /api/users`, and `DELETE /api/unit-assignments/:id`.
- **Role/usage:** ADMIN; currently reachable only if directly imported or routed in a future change.

### `frontend/src/pages/admin/AdminSoaPage.jsx`

- **Purpose:** Lists billing periods forwarded/available for Admin SOA review.
- **Exports/logic:** Loads periods, handles loading/error states, and links to batch detail.
- **API/data:** `GET /api/billing-periods`.
- **Role/usage:** ADMIN at `/admin/soa`.

### `frontend/src/pages/admin/AdminSoaBatchPage.jsx`

- **Purpose:** Reviews and publishes the bills in one forwarded billing period.
- **Exports/logic:** Loads bills by period, selects bills, submits publication, refreshes email-delivery status, and retries/resends failed or pending SOA emails.
- **API/data:** `GET /api/bills?billingPeriodId=...`, `POST /api/billing-periods/:id/publish`, and the retry/resend email-delivery endpoints.
- **Role/usage:** ADMIN at `/admin/soa/batches/:periodId`.

### `frontend/src/pages/admin/AdminSoaBillPage.jsx`

- **Purpose:** Displays and publishes/reviews one SOA.
- **Exports/logic:** Loads a bill, renders `SoaDocument`, publishes the individual bill through the batch endpoint, and retries/resends its email delivery.
- **API/data:** `GET /api/bills/:id`, publish, retry, and resend endpoints under `/api/billing-periods`.
- **Role/usage:** ADMIN at `/admin/soa/bills/:id`.

### `frontend/src/pages/admin/AdminPaymentsPage.jsx`

- **Purpose:** Payment queue and manual-payment entry.
- **Exports/logic:** Filters payments by status/unit, loads bills and credits for context, and records face-to-face or advance payments.
- **API/data:** `/api/payments`, `/api/bills`, `/api/units`, `/api/payments/credits`, and `POST /api/payments/manual`.
- **Role/usage:** ADMIN at `/admin/payments`.

### `frontend/src/pages/admin/AdminPaymentPage.jsx`

- **Purpose:** Payment detail and verification workspace.
- **Exports/logic:** Loads the payment, downloads the receipt blob, shows OCR/payment fields, submits approve/reject review, and supports Admin deletion.
- **API/data:** `GET /api/payments/:id`, `apiFile('/api/payments/:id/receipt')`, `POST /api/payments/:id/review`, and `DELETE /api/payments/:id`.
- **Role/usage:** ADMIN at `/admin/payments/:id`.

### `frontend/src/pages/admin/AdminAuditLogsPage.jsx`

- **Purpose:** Searchable audit history.
- **Exports/logic:** Maintains filters/pagination and displays actor, action, target, and metadata records.
- **API/data:** `GET /api/audit-logs` with query parameters.
- **Role/usage:** ADMIN at `/admin/audit-logs`.

## Collector pages

### `frontend/src/pages/collector/CollectorDashboard.jsx`

- **Purpose:** Collector landing page.
- **Exports/logic:** Renders `OperationalDashboard` with `COLLECTOR`.
- **API/data:** Shared dashboard and analytics endpoints.
- **Role/usage:** COLLECTOR at `/collector`.

### `frontend/src/pages/collector/CollectorBillingPage.jsx`

- **Purpose:** Creates/edits billing periods and imports live meter readings.
- **Exports/logic:** Loads periods, edits period rates/dates, previews workbook uploads, reviews validation results, saves readings, and generates bills.
- **API/data:** `/api/billing-periods`, including readings preview/save and `POST /:id/generate`.
- **Role/usage:** COLLECTOR at `/collector/billing`.

### `frontend/src/pages/collector/CollectorBillsPage.jsx`

- **Purpose:** Collector billing-batch list and status actions.
- **Exports/logic:** Combines billing-period and bill data, supports filtering, reopening, forwarding, and deleting incorrect batches.
- **API/data:** `/api/billing-periods` and `/api/bills`; mutations include reopen, forward, and delete.
- **Role/usage:** COLLECTOR at `/collector/bills`.

### `frontend/src/pages/collector/CollectorBillBatchPage.jsx`

- **Purpose:** Lists bills in one Collector billing batch.
- **Exports/logic:** Loads bills for a period and links to individual bill details.
- **API/data:** `GET /api/bills?billingPeriodId=...`.
- **Role/usage:** COLLECTOR at `/collector/bills/batches/:periodId`.

### `frontend/src/pages/collector/CollectorBillPage.jsx`

- **Purpose:** Displays and edits one generated, unforwarded bill.
- **Exports/logic:** Loads a bill, renders the SOA, submits permitted bill corrections, and refreshes the result.
- **API/data:** `GET/PATCH /api/bills/:id`.
- **Role/usage:** COLLECTOR at `/collector/bills/:id`.

### `frontend/src/pages/collector/CollectorUnitsPage.jsx`

- **Purpose:** Collector read-only unit/assignment records.
- **Exports/logic:** Loads units and assignments and renders operational occupancy information.
- **API/data:** `GET /api/units` and `GET /api/unit-assignments`.
- **Role/usage:** COLLECTOR at `/collector/units`.

### `frontend/src/pages/collector/CollectorPaymentsPage.jsx`

- **Purpose:** Collector view of approved payments.
- **Exports/logic:** Loads approved payment records and displays them without Admin review controls.
- **API/data:** `GET /api/payments?status=APPROVED`.
- **Role/usage:** COLLECTOR at `/collector/payments`.

### `frontend/src/pages/collector/CollectorHistoryImportPage.jsx`

- **Purpose:** Imports and manages historical analytics workbooks.
- **Exports/logic:** Lists historical months, previews `FormData`, confirms imports, and deletes selected/all historical periods.
- **API/data:** `GET/POST/DELETE /api/analytics/imports` and `POST /api/analytics/imports/preview`.
- **Role/usage:** COLLECTOR at `/collector/history-import`.

### `frontend/src/pages/collector/CollectorSoaTemplatePage.jsx`

- **Purpose:** Configures future SOA text/branding fields.
- **Exports/logic:** Loads the current template, edits fields, and saves normalized template data.
- **API/data:** `GET/PATCH /api/soa-template`.
- **Role/usage:** COLLECTOR at `/collector/soa-template`.

## Resident pages

### `frontend/src/pages/resident/ResidentDashboard.jsx`

- **Purpose:** Resident landing page with balances, recent bills/payments, and water insights.
- **Exports/logic:** Loads bills, payments, resident analytics, and recommendations; selects the active assigned unit; lets the resident mark insights viewed.
- **API/data:** `/api/bills`, `/api/payments`, `/api/analytics/resident`, and `/api/prescriptive-recommendations/resident`.
- **Role/usage:** RESIDENT at `/resident`.

### `frontend/src/pages/resident/ResidentBillsPage.jsx`

- **Purpose:** Lists published SOAs available to the resident.
- **Exports/logic:** Loads bills, handles loading/errors, and links to bill detail.
- **API/data:** `GET /api/bills`.
- **Role/usage:** RESIDENT at `/resident/bills`.

### `frontend/src/pages/resident/ResidentBillPage.jsx`

- **Purpose:** Shows one SOA and submits a receipt.
- **Exports/logic:** Loads the bill, previews the selected receipt, submits the final multipart form, then reloads the bill to show the pending payment state.
- **API/data:** `GET /api/bills/:id`, `POST /api/payments/bills/:id/preview`, and `POST /api/payments/bills/:id`.
- **Role/usage:** RESIDENT at `/resident/bills/:id`.

### `frontend/src/pages/resident/ResidentPaymentsPage.jsx`

- **Purpose:** Resident payment history.
- **Exports/logic:** Builds status/unit/date filters and renders payment submissions visible to the assigned resident.
- **API/data:** `GET /api/payments` with query parameters.
- **Role/usage:** RESIDENT at `/resident/payments`.

## Shared pages

### `frontend/src/pages/shared/OperationalDashboard.jsx`

- **Purpose:** Shared Admin/Collector operational overview.
- **Exports/logic:** Loads summary metrics and analytics in parallel, then renders billing, payment, unit, and forecast cards according to role.
- **API/data:** `GET /api/dashboard/overview` and `GET /api/analytics/overview`.
- **Role/usage:** Wrapped by Admin and Collector dashboards.

### `frontend/src/pages/shared/AnalyticsPage.jsx`

- **Purpose:** Staff analytics and recommendation-management page.
- **Exports/logic:** Loads overview analytics and recommendations, displays charts/tables, and allows staff to delete recommendations.
- **API/data:** `GET /api/analytics/overview`, `GET /api/prescriptive-recommendations`, and `DELETE /api/prescriptive-recommendations/:id`.
- **Role/usage:** ADMIN and COLLECTOR routes in `App.jsx`.

### `frontend/src/pages/shared/ProfilePage.jsx`

- **Purpose:** Read-only current-user profile.
- **Exports/logic:** Reads `useAuth` and renders name, email, and role inside `DashboardLayout`/`Panel`.
- **API/data:** No direct API calls; identity is supplied by `AuthContext`.
- **Role/usage:** All authenticated roles at `/profile`.

### `frontend/src/pages/shared/SettingsPage.jsx`

- **Purpose:** Browser-local display preferences.
- **Exports/logic:** Toggles compact sidebar mode and persists the preference in browser storage/state.
- **API/data:** No backend API; preference is local to the browser.
- **Role/usage:** All authenticated roles at `/settings`.

## Frontend developer notes

- Page components own loading, error, and mutation state. The backend remains the authority for permissions and calculations.
- Multipart receipt/workbook uploads must pass `FormData` to `apiRequest`; the helper intentionally does not set `Content-Type` for `FormData` so the browser can add its boundary.
- Route protection improves UX but is not a security boundary; every backend route independently applies JWT and role checks.
- `SoaDocument` is presentation-only. It should not recalculate totals; the bill returned by the backend is authoritative.
- `AdminAssignmentsPage.jsx` remains implemented but the current route table redirects the corresponding path to `AdminUnitsPage.jsx`.
