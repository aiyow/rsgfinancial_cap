# Learn the RSG Condo System

These guides explain the source code checked on October 13, 2026. Start with the overview, then trace a feature from its browser page to its API route and database tables.

## Reading order

1. [Codebase overview](CODEBASE_OVERVIEW.md): roles, vocabulary, architecture, data relationships, and the monthly workflow.
2. [Frontend code guide](FRONTEND_CODE_GUIDE.md): React startup, authentication, routes, page state, shared components, and API calls.
3. [Backend code guide](BACKEND_CODE_GUIDE.md): Express middleware, endpoints, transactions, billing, payments, analytics, and tests.
4. [Category payment rollout](category-payments-rollout.md): maintenance checks for activating payment policy version 2 on an existing database.

For installation, use the project [README](../README.md) and [local setup guide](../LOCAL_SETUP_GUIDE.md). For source behavior, use these guides: older setup text still describes role-selectable registration, Collector template editing, or a fixed five-month regression; the current implementation has changed those rules.

## Study plan

| Session | Read and trace | Check your understanding |
| --- | --- | --- |
| 1. Structure | Overview; `main.jsx`; `App.jsx`; `server.js` | Explain what runs in the browser, Node, PostgreSQL, and external services. |
| 2. Accounts | `AuthContext.jsx`; `Login.jsx`; `authRoutes.js`; `authMiddleware.js` | Explain saved-token validation and how password reset invalidates old sessions. |
| 3. Billing | `CollectorBillingPage.jsx`; `billingPeriodRoutes.js`; `meterReadingValidation.js` | Calculate charges; distinguish generation, forwarding, and publication. |
| 4. Payments | `ResidentBillPage.jsx`; `AdminPaymentPage.jsx`; `paymentAllocation.js`; `paymentLedger.js` | Explain submission, allocation, application, credit, and tenant permissions. |
| 5. Analytics | `AnalyticsPage.jsx`; `analyticsRoutes.js`; `predictiveAnalytics.js`; `prescriptiveAnalytics.js` | Explain eligibility, model policy, accuracy, and recommendations. |
| 6. Corrections | `BillingErrorsPage.jsx`; `billRoutes.js`; email services | Explain open reports, payment reconciliation, and delivery recovery. |

The detailed guides link these filenames to their exact source locations.

## Other documents

- The ERD PDFs are design references. The executable schema is `backend/database/schema.sql` plus numbered migrations; older diagrams may omit recent tables.
- `Capstone Project Plano.docx` is a planning artifact.
- The operational user manual is under [system/](../system/).

Use a disposable local database for exercises that generate bills, approve payments, send email, or change records. These guides describe checked-in behavior; they do not establish the migration or configuration state of a deployed installation.
