# RSG Condo Codebase Overview

This guide explains how the RSG Condo Water Billing & Management System is assembled and how a request travels through the application. It is the starting point for the more detailed [frontend code guide](FRONTEND_CODE_GUIDE.md) and [backend code guide](BACKEND_CODE_GUIDE.md).

## 1. What the system does

RSG Condo is a role-based condominium billing system. It maintains residents and units, imports monthly water-meter readings, calculates charges, produces Statements of Account (SOAs), publishes statements, accepts payment receipts, verifies payments, and provides water-use analytics.

The three operating roles are:

| Role | Main responsibilities |
|---|---|
| **ADMIN** | Manage users, units, and assignments; review and publish SOAs; verify or record payments; review audit logs; manage recommendations. |
| **COLLECTOR** | Configure the SOA template; create billing periods; upload readings; generate and forward SOAs; import historical analytics; review bills, payments, and recommendations. |
| **RESIDENT** | View published SOAs for assigned units; upload payment receipts; view payment history; view resident-facing water insights. |

## 2. Technology and runtime boundaries

- **Frontend:** React 19, React Router, Vite, Tailwind CSS, Lucide icons, and Recharts. The browser entry point is `frontend/src/main.jsx`.
- **Backend:** Node.js, Express, PostgreSQL (`pg`), Zod validation, ExcelJS workbook parsing, Multer uploads, Tesseract OCR, Sharp image processing, Cloudinary receipt storage, and Nodemailer.
- **Authentication:** The backend issues JWTs. The frontend stores the token in `localStorage` through `AuthContext` and sends it as `Authorization: Bearer <token>`.
- **Database:** `backend/config/db.js` creates a PostgreSQL connection pool. Routes and services use parameterized SQL against the schema and numbered migrations in `backend/database`.
- **External services:** SMTP is used for SOA email; Cloudinary stores private receipt images; Tesseract/Sharp inspect receipt uploads. These integrations are optional/configured through backend environment variables.

## 3. Folder map

```text
frontend/
  src/
    App.jsx                 Route table and role-protected page composition
    components/             Reusable layout, SOA, notification, and guard components
    context/                Authentication state and React context
    hooks/                  Small reusable React hooks
    pages/                  Login/register and role-specific screens
    services/api.js         Fetch wrapper used by all screens
    constants/routes.js     Role-to-dashboard route mapping

backend/
  server.js                 Express app, middleware, route registration, health check
  config/db.js              PostgreSQL pool
  middleware/               JWT authorization, validation, and error normalization
  routes/                   HTTP endpoints and SQL orchestration
  services/                 Reusable calculations, storage, email, analytics, and audit logic
  scripts/                  Database setup, seeding, data import, and receipt migration
  test/                     Node's built-in test cases for isolated services
  database/                 Base schema and migrations
```

## 4. How a browser request works

1. `main.jsx` mounts `App` inside `AuthProvider` and `BrowserRouter`.
2. `App.jsx` selects a page from the URL. `ProtectedRoute` checks the authenticated user and permitted role before rendering role-specific pages.
3. A page calls `apiRequest` or `apiFile` from `frontend/src/services/api.js`.
4. The API helper adds JSON or multipart headers and the JWT authorization header, then calls the configured `VITE_API_URL` (default `http://localhost:5000`).
5. `server.js` sends the request to a route module such as `/api/bills` or `/api/payments`.
6. Authentication and role middleware reject missing or unauthorized tokens. Zod schemas validate request bodies where applicable.
7. The route performs parameterized PostgreSQL queries and delegates calculations or integrations to a service.
8. The route returns JSON (or an authenticated receipt file). The page updates React state, displays a success/error message, and may reload related data.

## 5. Main business flows

### Login and role routing

1. `Login.jsx` submits credentials to `POST /api/auth/login`.
2. `AuthContext` stores the returned token and user, then `dashboardPathFor` maps the role to `/admin`, `/collector`, or `/resident`.
3. On refresh, `AuthContext` calls `GET /api/auth/me`. An invalid token clears the session.
4. `ProtectedRoute` prevents access to another role's pages and redirects unauthenticated users to `/login`.

### Monthly billing and SOA publication

1. A Collector creates a draft billing period at `POST /api/billing-periods` with dates, due date, water rate, and association-dues rate.
2. The Collector previews an `.xlsx` meter workbook at `POST /api/billing-periods/:id/readings/preview`. The backend validates unit numbers, previous/current readings, continuity, and duplicates.
3. The Collector saves corrected readings with `PUT /api/billing-periods/:id/readings`.
4. `POST /api/billing-periods/:id/generate` calculates consumption, water charge, association dues, late-penalty inputs, and a bill/SOA for each applicable unit. Forecasts and recommendations may be regenerated as part of this workflow.
5. The Collector reviews or edits generated, unforwarded bills, then forwards the batch with `POST /api/billing-periods/:id/forward`.
6. An Admin reviews the forwarded batch and publishes selected SOAs with `POST /api/billing-periods/:id/publish`. Publishing creates email-delivery records and sends configured SOA emails.
7. Residents can see only published SOAs for their active unit assignments.

### Receipt submission and payment verification

1. A Resident selects an unpaid SOA and uploads a JPG/PNG receipt to `POST /api/payments/bills/:id/preview` for OCR/quality preview.
2. The final upload goes to `POST /api/payments/bills/:id`. The backend stores the private receipt, records OCR data, and creates a pending payment submission.
3. An Admin opens the payment detail and retrieves the receipt through the authenticated `GET /api/payments/:id/receipt` endpoint.
4. The Admin approves or rejects the submission at `POST /api/payments/:id/review`, supplying verified amount/date/method/reference or a rejection reason.
5. Approved amounts are allocated through `paymentLedger.js` to open SOAs. Excess becomes unit credit; the ledger tables are the source of truth for balances.
6. Residents and Collectors see payment records according to their role and unit visibility rules.

### Predictive and prescriptive analytics

1. A Collector imports historical workbooks through `/api/analytics/imports`. Historical periods improve forecasting and do not create live SOAs.
2. `predictiveAnalytics.js` selects five consecutive valid monthly readings, performs linear regression, and produces a next-period consumption forecast and accuracy data.
3. `prescriptiveAnalytics.js` evaluates forecasts and history for rising consumption, possible vacant-unit use, payment reminders, high-use thresholds, and insufficient-data monitoring insights.
4. Staff see aggregate analytics through `/api/analytics/overview`; Residents see only assigned-unit insights through `/api/analytics/resident` and `/api/prescriptive-recommendations/resident`.
5. A resident can mark their own recommendation viewed. Admin/Collector can delete recommendations; audit logging records important actions.

## 6. Data and security rules

- Never expose `DB_*`, `JWT_SECRET`, SMTP credentials, or Cloudinary secrets in `frontend/.env`; only `VITE_*` values are bundled into the browser.
- Receipts are private financial records. The frontend receives them through an authenticated API file response rather than a public Cloudinary URL.
- SQL queries should remain parameterized. Route-level role checks are required even though the UI also hides unavailable actions.
- Residents are filtered to published bills, active assignments, and their own unit/payment data. Collectors can review approved payments but cannot approve or reject them.
- Billing events, account changes, payment actions, and recommendation actions are retained in `audit_logs` where implemented by the route/service.

## 7. Current developer notes

- The source tree contains `backend/node_modules`; it is intentionally excluded from the code guides because it is third-party code.
- `frontend/src/services/api.js` currently declares `API_URL` but its `apiRequest` fetch expression references `APIc_URL`. If that spelling is present at runtime, API requests fail before reaching the backend; verify and correct it during development.
- The current project enables public role registration as a development helper. Production deployment should restrict account creation to Admin-controlled user management.
- The five-month forecast requirement means a unit with missing, flagged, or discontinuous readings may show a monitoring/insufficient-history state rather than a forecast.

## 8. Related references

- [Frontend Code Guide](FRONTEND_CODE_GUIDE.md)
- [Backend Code Guide](BACKEND_CODE_GUIDE.md)
- [Project README](../README.md)
- [End-user manual](../system/RSG_Condo_User_Manual.html)
