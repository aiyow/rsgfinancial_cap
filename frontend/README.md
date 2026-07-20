# RSG Condo Frontend

React and Vite frontend for the RSG Condo Management and Billing System.

For full backend, database, payment, analytics, and deployment guidance, see the [root README](../README.md).

## Setup

Run these commands from `frontend`:

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Use the following value in `.env` when the API is local:

```dotenv
VITE_API_URL=http://localhost:5000
```

Do not put database, JWT, SMTP, or Cloudinary secrets in this file: every `VITE_` variable is available to the browser.

## Main screens

- **Admin:** users, units and assignments, SOA review and publication, email-delivery retry/resend, payment approval, audit logs, and recommendation review.
- **Collector:** billing-period creation, meter-reading uploads, SOA generation and forwarding, historical analytics import, forecasts, and payment/recommendation review.
- **Resident:** published SOAs, receipt submission, payment history, and per-unit prescriptive insights inside Water consumption analytics.

Residents can switch between their current unit assignments in the analytics panel. Eligible insights appear after bill generation, before SOA publication, and residents can mark their own insights as viewed.

## Commands

```powershell
npm run dev      # Start the Vite development server
npm run lint     # Run ESLint
npm run build    # Create the production build in dist/
npm run preview  # Preview the production build locally
```
