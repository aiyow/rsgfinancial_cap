# RSG Condo Management and Billing System

RSG Condo is a role-based condominium billing and water-analytics system. It supports monthly meter-reading imports, Statement of Account (SOA) generation, payment verification, resident access, predictive water forecasts, prescriptive recommendations, audit logs, and operational dashboards.

## Main features

- **Admin:** manage users, units, and resident assignments; review and publish SOAs; verify payments; review audit logs; manage recommendations; and retry or resend SOA emails.
- **Collector:** create monthly billing periods; upload meter readings; generate and forward SOAs; manage the SOA template; import historical analytics data; review forecasts, payments, and recommendations.
- **Resident:** view published SOAs for assigned units; upload payment receipts; review payment history; and view their unit's automatically generated prescriptive insights.
- **Analytics:** five-month linear-regression forecasts, forecast accuracy, historical versus projected charts, reading-quality checks, and explainable recommendations for each unit.

## Technology

- Frontend: React 19, Vite, Tailwind CSS, Recharts, and Lucide icons
- Backend: Node.js, Express, PostgreSQL, Zod, ExcelJS, Tesseract.js, Sharp, Cloudinary, and Nodemailer
- Authentication: JSON Web Tokens (JWT) and bcrypt password hashing

## Prerequisites

Install these before setting up the project:

- [Node.js](https://nodejs.org/) 22 LTS recommended
- [PostgreSQL](https://www.postgresql.org/download/) 14 or newer
- Git
- Optional: pgAdmin if you prefer a graphical PostgreSQL interface

Confirm that Node.js and npm are available:

```powershell
node --version
npm --version
```

## 1. Clone the project

```powershell
git clone <your-github-repository-url>
cd "Real Capstone Proj"
```

Replace `<your-github-repository-url>` with the GitHub repository URL. The local folder name may be different from `Real Capstone Proj`.

## 2. Create the PostgreSQL database

Using the PostgreSQL command line:

```powershell
psql -U postgres -c "CREATE DATABASE rsg_condo;"
```

If `psql` is not recognized, open pgAdmin, connect to the local PostgreSQL server, right-click **Databases**, select **Create > Database**, and name it `rsg_condo`.

Do not import `database/caps_db.sql` into a shared installation. That file is a local export and may contain private data. A fresh installation should use the initializer described below.

## 3. Configure and initialize the backend

Open a terminal in the project root:

```powershell
cd backend
npm install
Copy-Item .env.example .env
```

On macOS or Linux, use `cp .env.example .env` instead of `Copy-Item`.

Edit `backend/.env` and replace every placeholder. This file is used only by the backend:

```dotenv
PORT=5000

DB_HOST=localhost
DB_PORT=5432
DB_NAME=rsg_condo
DB_USER=postgres
DB_PASSWORD=your_postgres_password

JWT_SECRET=use_a_long_random_secret_here

SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=choose_a_strong_admin_password
SEED_COLLECTOR_EMAIL=collector@example.com
SEED_COLLECTOR_PASSWORD=choose_a_strong_collector_password

CLIENT_URL=http://localhost:5173

# SOA email notifications. Use port 465 with SMTP_SECURE=true, or port 587
# with SMTP_SECURE=false when your provider uses STARTTLS.
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_smtp_username
SMTP_PASSWORD=your_smtp_password
SMTP_FROM="RSG Condo Billing <billing@example.com>"

# Private receipt storage: backend only. Never use VITE_ names for these values.
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
CLOUDINARY_RECEIPTS_FOLDER=rsg-condo/payment-receipts
```

Never commit `backend/.env`. It contains database credentials, seeded-account passwords, the JWT secret, and the Cloudinary API secret. If a secret has ever been pasted into a chat, screenshot, or repository, rotate it in the relevant provider console.

Use a long random value for `JWT_SECRET`. Changing it later signs out every user because existing login tokens are no longer valid. You can generate a value in PowerShell with:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Cloudinary payment receipts

Payment receipts are private financial records. They are uploaded by the backend to Cloudinary as authenticated image assets; residents and staff continue to access them only through the existing authenticated API route. The Cloudinary API secret must never be added to the frontend environment file.

In the Cloudinary Console, open **Settings > API Keys** and copy the Cloud name, API key, and API secret into `backend/.env`:

```dotenv
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
CLOUDINARY_RECEIPTS_FOLDER=rsg-condo/payment-receipts
```

No unsigned upload preset is required because this system uploads through the backend. After adding the variables, apply the latest database migration:

```powershell
npm run db:init
```

For an existing local database, first preview local receipt records, then migrate them. The command does not delete local files:

```powershell
npm run receipts:migrate-cloudinary -- --dry-run
npm run receipts:migrate-cloudinary
```

Open each migrated payment through the Admin payment screen to confirm the image loads. Keep `backend/uploads/payment-proofs` as a rollback copy until every migrated receipt has been verified.

Initialize the schema and all numbered migrations:

```powershell
npm run db:init
```

This command creates the base schema and applies migrations `001` through `021` in order. The initializer does not keep a migration-history table, so use it for a new database (or a disposable local development database) and make a backup before running it against an existing database.

Create the initial Admin and Collector accounts using the values from `backend/.env`:

```powershell
npm run seed
```

The seed command is duplicate-safe. If an account with the configured email already exists, it will not create another one.

### Optional: add the physical units

The shareable seed contains the 173 unit numbers, floors, and billable areas from the project. It creates no residents, assignments, bills, readings, or payments. Every unit starts as `VACANT`.

From the project root:

```powershell
psql -U postgres -d rsg_condo -f database/seed_units_only.sql
```

Alternatively, open `database/seed_units_only.sql` in pgAdmin's Query Tool and execute it. The script ignores units that already exist.

## 4. Configure the frontend

Open a second terminal in the project root:

```powershell
cd frontend
npm install
Copy-Item .env.example .env
```

The default frontend environment is:

```dotenv
VITE_API_URL=http://localhost:5000
```

Change this URL only when the backend is running on another host or port. Do not include a trailing slash. Do not put database credentials, JWT secrets, or Cloudinary credentials in `frontend/.env`, because every `VITE_` variable is exposed to the browser. Do not commit `frontend/.env`.

## 5. Run the system

Keep both terminals open.

Backend terminal:

```powershell
cd backend
npm run dev
```

Frontend terminal:

```powershell
cd frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in a browser. The backend health check is available at [http://localhost:5000/api/health](http://localhost:5000/api/health).

Sign in using the Admin or Collector email and password configured in `backend/.env` before running `npm run seed`.

## Configuration checks

After setup, verify each layer before using the system:

1. **Backend and database:** open [http://localhost:5000/api/health](http://localhost:5000/api/health). It must return a successful JSON response with a database time.
2. **Frontend:** open [http://localhost:5173](http://localhost:5173). If it says it cannot reach the backend, confirm `VITE_API_URL`, the backend terminal, and port `5000`.
3. **Authentication:** sign in with the seeded Admin account. If sign-in fails, check `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, then run `npm run seed` again.
4. **Cloudinary receipts:** while signed in as a Resident, open an unpaid SOA and upload a JPG or PNG receipt. Confirm it appears in Admin **Payments**, then open the receipt from Admin. The image is streamed through the authenticated API; its Cloudinary URL should never appear in the frontend configuration.
5. **SOA email:** after SMTP is configured, publish a test SOA for a resident with an email address. The Admin SOA screen shows sent and failed delivery counts and can retry or resend emails.

Useful development commands:

```powershell
# backend (from backend/)
npm test
npm run db:init
npm run seed

# frontend (from frontend/)
npm run lint
npm run build
```

## Common setup problems

| Problem | What to check |
| --- | --- |
| `password authentication failed` or database health returns 500 | Confirm PostgreSQL is running and verify `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` in `backend/.env`. |
| `Cloudinary receipt storage is not configured` | Add all four `CLOUDINARY_*` variables to `backend/.env`, then restart the backend. Do not add them to the frontend. |
| Browser shows `Cannot reach the backend` | Start the backend with `npm run dev` and make sure `VITE_API_URL` points to it. Restart Vite after changing the frontend `.env`. |
| A new backend environment cannot read receipt images | Use the same Cloudinary cloud and receipt folder that hold the receipt assets, and configure valid API credentials. |
| SOA emails remain pending or fail | Confirm every `SMTP_*` variable is valid, the sender is permitted by the provider, and `SMTP_SECURE` matches the selected port. |
| Database initialization fails on an existing database | Restore or back up first. The current initializer re-executes numbered migrations, so it is intended for a fresh or disposable development database. |

## Recommended first-time setup inside the system

1. Sign in as **Admin**.
2. Open **Manage Units** and confirm that the unit seed was imported, or add units manually.
3. Create Resident accounts under **User Management**.
4. Open **Manage Units**, choose **Edit** for a unit, and assign the Resident as an owner or tenant. Set the primary payer where applicable.
5. Sign in as **Collector** and configure the **SOA Template**.
6. Import at least five consecutive months of valid historical readings through **Analytics Import** if forecasts are required immediately.
7. Create the current billing period under **Monthly Billing**.

## Monthly billing workflow

### Collector

1. Open **Monthly Billing**.
2. Create a draft period with the period dates, due date, water rate per cubic meter, and association-dues rate per square meter.
3. Upload and preview the meter-reading workbook.
4. Fix missing or flagged readings before continuing when possible.
5. Generate one SOA for every unit.
6. Review generated SOAs and edit an SOA if a correction is required.
7. Forward the billing batch to Admin.

The monthly-reading workbook must be an `.xlsx` file with these column headers:

| Column | Meaning |
| --- | --- |
| `UNIT` | Unit number exactly as stored in the system |
| `PREVIOUS` | Previous cumulative meter reading |
| `PRESENT` | Current cumulative meter reading |

The server recalculates consumption and charges. Spreadsheet formulas are not treated as authoritative.

### Admin

1. Open **Forwarded SOAs**.
2. Open the forwarded billing batch and review its statements.
3. Publish the selected SOAs to Residents. When SMTP is configured, the system records and sends SOA email deliveries to the saved resident recipients.
4. Use **Audit Logs** to review important billing and account changes.

### Resident

1. Open **My SOAs** to view a published statement.
2. Open an unpaid SOA and upload a JPG or PNG receipt.
3. Wait for Admin verification.
4. Review approved or rejected submissions under **Payment History**.

### Payment verification

1. Admin opens **Payments**.
2. Review the receipt image and OCR result.
3. Approve with the verified amount, payment date, method, and reference number, or reject with a reason.
4. Approved payments are applied to open SOAs. Any remaining verified amount becomes unit credit for later bills.

Collectors can view approved payments but cannot approve or reject them.

### Payment records and allocation

The payment ledger uses two tables with separate purposes:

- `payment_submissions` stores the resident or staff payment record, receipt, verification state, and the resident's original intended bill in `target_unit_bill_id`. Advance payments have no target bill.
- `payment_applications` stores the approved accounting allocation. One approved submission can be split across more than one open SOA, and this table is the source of truth for bill balances.

The intended target is retained for history even if the approved payment is allocated differently. The former `payment_submission_targets` table was removed; API responses continue to use the field name `targetBillId`.

### Billing history and period types

`billing_periods.period_type` distinguishes real billing from imported history:

- `LIVE_BILLING` creates and manages real SOAs.
- `HISTORICAL_ANALYTICS` supplies forecast history and does not create real SOAs.

Billing activity, including generation, edits, forwarding, publishing, reopening, and deletion, is recorded in `audit_logs`. The former `billing_events` table and recommendation-action history table were removed to keep one canonical audit trail.

## Predictive and prescriptive water analytics

The forecast engine requires five consecutive valid monthly readings for a unit. A flagged reading or continuity break can make that unit temporarily insufficient for forecasting.

The historical analytics workbook must be an `.xlsx` file containing:

| Column | Meaning |
| --- | --- |
| `UNIT` | Unit number |
| `PREVIOUS` | Previous cumulative reading |
| `PRESENT` | Current cumulative reading |
| `CONSUMPTION` | Workbook consumption used for comparison |
| `WRATE` | Water rate per cubic meter |
| `WATER BILLED` | Workbook water charge used for comparison |

The server verifies the workbook and performs its own calculations. Historical imports improve the forecast but do not create real SOAs. If a live billing batch already exists for the selected month, the importer verifies that the workbook matches the saved readings and refreshes the forecast without overwriting live billing data.

Prescriptive recommendations include:

- Review a flagged meter reading.
- Collect additional readings when fewer than five consecutive valid months exist.
- Identify three consecutive months of rising consumption.
- Flag possible water use in a unit marked vacant.
- Remind a resident about a balance due within five days.
- Check possible high usage when the forecast is at least 15% above the recent positive-consumption baseline.
- Provide a neutral monitoring insight when there are too few positive readings for a reliable percentage comparison.

The system keeps the recommendation's current state in `prescriptive_recommendations`: `OPEN`, `VIEWED`, or `SUPERSEDED`. It records resident viewing and staff deletion in `audit_logs`; it does not use a separate recommendation-action table.

When the Collector generates a live billing period, forecasts and recommendations are regenerated in the same workflow. Resident-visible insights (`CHECK_HIGH_USAGE`, `RISING_CONSUMPTION`, `PAYMENT_REMINDER`, `MONITOR_HIGH_USAGE`, and `MONITOR_USAGE`) appear in the resident dashboard's **Water consumption analytics** for the selected assigned unit as soon as bills are generated. They do not wait for Admin publication of the SOA. Residents can mark only their own insight as viewed; it stays visible after viewing. Admin and Collector can permanently delete recommendations.

Zero-consumption months remain visible as zero on charts. They are excluded only from percentage-baseline calculations: high-usage percentage alerts require at least two positive recent readings. With fewer than two, the system shows a monitoring insight instead of a misleading percentage alert.

## Useful commands

Backend commands, run from `backend`:

```powershell
npm run dev       # Start with automatic restart
npm start         # Start normally
npm run db:init   # Create schema and apply migrations on a fresh database
npm run seed      # Create configured Admin and Collector accounts
npm test          # Run backend tests
npm run data:import-history # Import historical analytics workbook data
npm run receipts:migrate-cloudinary # Move local receipt files to Cloudinary
```

Frontend commands, run from `frontend`:

```powershell
npm run dev       # Start the Vite development server
npm run lint      # Run ESLint
npm run build     # Create a production build in frontend/dist
npm run preview   # Preview the production build locally
```

## Project structure

```text
backend/
  config/                 PostgreSQL connection
  database/               Base schema and migrations
  middleware/             Authentication, validation, error handling
  routes/                 REST API routes
  scripts/                Database initialization and account seeding
  services/               Billing, OCR, payment, SOA, and analytics logic
  test/                   Backend tests
frontend/
  public/                 Static assets
  src/components/         Shared layout and SOA components
  src/pages/              Admin, Collector, Resident, and shared pages
  src/services/           API client
database/
  seed_units_only.sql     Shareable physical unit seed with no resident data
```

## GitHub and data privacy

The repository `.gitignore` excludes environment files, uploads, build output, dependencies, and the local `database/caps_db.sql` export.

Before pushing to GitHub, run:

```powershell
git status
```

Do not commit any of the following:

- `backend/.env` or `frontend/.env`
- PostgreSQL dumps containing real users, assignments, readings, bills, receipts, payments, or audit logs
- `backend/uploads/`
- Screenshots or spreadsheets containing resident names, emails, payment references, or meter history

The safe database artifact intended for sharing is `database/seed_units_only.sql`.

Public registration is currently enabled as a development helper and allows a role to be selected. Before hosting the application publicly, disable open role registration or restrict account creation to Admin.

## Troubleshooting

### `psql` is not recognized

Use pgAdmin's Query Tool, or add PostgreSQL's `bin` directory to the system `PATH`.

### Database authentication failed

Check `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` in `backend/.env`. Confirm that PostgreSQL is running.

### Frontend cannot reach the backend

Confirm that the backend is running on port `5000` and that `frontend/.env` contains `VITE_API_URL=http://localhost:5000`. Restart the Vite server after changing its environment file.

### Login fails after setup

Confirm that `npm run seed` completed successfully and use the `SEED_ADMIN_*` or `SEED_COLLECTOR_*` credentials from `backend/.env`.

### Forecasts are unavailable

Import at least five consecutive valid monthly readings. Review flagged readings and confirm that month-to-month readings are continuous.

### Receipt upload fails

Use a readable JPG or PNG file under 5 MB. Blurry or low-resolution images may be rejected by the OCR quality check.

## Verification before sharing

Run these checks:

```powershell
cd backend
npm test

cd ../frontend
npm run lint
npm run build
```

When all commands pass, the code is ready to push. Database content and uploaded receipts remain local and must be transferred separately only when explicitly authorized.
