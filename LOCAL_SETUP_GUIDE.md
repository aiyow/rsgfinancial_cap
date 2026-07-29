# RSG Condo: Local Setup and Troubleshooting Guide

This guide is for running the system on one Windows computer with PostgreSQL, Node.js, and pgAdmin. It follows the same general workflow used for this project, but uses the current schema and migrations so that payment, billing-period, email, and prescriptive-insight features all work.

## Before you start

Install:

- Node.js 22 LTS (or a compatible current Node.js version)
- PostgreSQL 14 or newer, including pgAdmin and the `psql` command-line tool
- Git

Check Node.js from Command Prompt or PowerShell:

```powershell
node --version
npm --version
```

## 1. Clone the repository

```powershell
git clone <your-github-repository-url>
cd "Real Capstone Proj"
```

Replace the URL and folder name with your own repository details.

## 2. Create the PostgreSQL database

Open **Node.js command prompt**, Command Prompt, or PowerShell and run:

```powershell
psql -U postgres -c "CREATE DATABASE rsg_condo;"
```

Enter the password for the PostgreSQL `postgres` account when prompted. A successful result is:

```text
CREATE DATABASE
```

You can also create `rsg_condo` in pgAdmin: right-click **Databases** → **Create** → **Database**.

## 3. Install and configure the backend

From the project root:

```powershell
cd backend
npm install
Copy-Item .env.example .env
```

Open `backend/.env` and set at least the database password and a strong JWT secret:

```dotenv
DB_HOST=localhost
DB_PORT=5432
DB_NAME=rsg_condo
DB_USER=postgres
DB_PASSWORD=your_actual_postgres_password

JWT_SECRET=replace_with_a_long_random_value
CLIENT_URL=http://localhost:5173
```

`JWT_SECRET=123456` will let the application start locally, but it is unsafe. Generate a secure value instead:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Paste the generated value after `JWT_SECRET=`. Do not commit `.env` to GitHub.

### Optional services

Keep the supplied Cloudinary and SMTP entries in `.env` when you need receipt uploads or SOA email delivery. Those features need valid provider credentials; the general dashboard and local account registration can run without testing them.

## 4. Initialize the current database schema

Still inside `backend`, run:

```powershell
npm run db:init
```

This creates the base schema and applies migrations `001` through `022`. It is the supported setup path for a newly created, empty `rsg_condo` database.

Optionally add the 173 physical units after the schema has been initialized. From the project root:

```powershell
psql -U postgres -d rsg_condo -f database/seed_units_only.sql
```

Create the configured Admin and Collector accounts, if you want to use the values in `backend/.env`:

```powershell
cd backend
npm run seed
```

## Do not use `caps_db.sql` for a new setup

Your earlier workflow—creating the database, opening pgAdmin Query Tool, pasting `database/caps_db.sql`, and executing it—can make an older local version start. However, that file is a legacy local export: it contains old schema concepts such as `analytics_only` and `billing_events`, while the current application uses `period_type` and `audit_logs`.

For a fresh clone, use `npm run db:init` instead. Do **not** run both `caps_db.sql` and `npm run db:init` on the same database: the initializer replays migrations and can fail because objects already exist.

If you already imported `caps_db.sql` and only need a current development database, back up any important local data, create a new empty database, and follow the supported initialization steps above.

## 5. Start and check the backend

From `backend`:

```powershell
npm run dev
```

Expected output includes:

```text
Server running at http://localhost:5000
Connected to the database
```

Open [http://localhost:5000/api/health](http://localhost:5000/api/health). A correct result contains `Server and database are working` and a database time.

## 6. Install and start the frontend

Open a **second** terminal. From the project root:

```powershell
cd frontend
npm install
npm run dev
```

Open the Local URL shown by Vite, normally [http://localhost:5173](http://localhost:5173).

The frontend uses `http://localhost:5000` by default. Only create `frontend/.env` when the backend uses another address or port:

```powershell
Copy-Item .env.example .env
```

Then set:

```dotenv
VITE_API_URL=http://localhost:5000
```

For local demonstration, you can register an account in the portal. Open public role registration must be disabled or restricted before any public deployment.

## Troubleshooting

| Problem | Likely cause | Solution |
| --- | --- | --- |
| `psql` is not recognized | PostgreSQL command-line tools are not on PATH. | Use pgAdmin Query Tool to create the database, or add PostgreSQL's `bin` folder to PATH and open a new terminal. |
| `password authentication failed for user "postgres"` | The password in the prompt or `DB_PASSWORD` is wrong. | Confirm the PostgreSQL password in pgAdmin, then update `backend/.env` and restart the backend. |
| `database "rsg_condo" already exists` | The database was created previously. | Use the existing database if it is the correct one. If you need a clean database, back up important data first, then delete and recreate it through pgAdmin. |
| `Database connection failed` at `/api/health` | PostgreSQL is stopped, the database is missing, or `.env` values do not match PostgreSQL. | Start the PostgreSQL service; verify `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`; then restart `npm run dev`. |
| `relation ... does not exist` | The database is empty or schema initialization did not complete. | Run `npm run db:init` against a new empty `rsg_condo` database, then restart the backend. |
| `column "period_type" does not exist` or missing-table errors after importing `caps_db.sql` | The legacy export does not match the current code. | Back up local data, create a new database, and use `npm run db:init`. |
| `npm` is not recognized or `npm install` fails because of Node version | Node.js is missing or too old. | Install Node.js 22 LTS, close and reopen the terminal, then run `node --version`. |
| `EADDRINUSE` or port 5000 is already in use | Another backend process is using port 5000. | Stop the old backend terminal, or change `PORT` in `backend/.env` and set the same URL in `frontend/.env`. |
| The browser says it cannot reach the backend | The backend is not running or `VITE_API_URL` is incorrect. | Start the backend, open `/api/health`, correct `frontend/.env` if needed, and restart `npm run dev`. |
| Registration or login fails | Backend is unavailable, credentials are incorrect, or a required field is missing. | Check `/api/health`, use the seeded account credentials or valid registration details, and read the error message shown in the portal. |
| Receipt upload says Cloudinary is not configured | Cloudinary credentials are placeholders or missing. | Fill in all `CLOUDINARY_*` values in `backend/.env` and restart the backend. |
| SOA email delivery fails | SMTP credentials or port/security settings are wrong. | Verify all `SMTP_*` values. Use `SMTP_SECURE=true` for port 465, or normally `false` for port 587. |

## Final local checks

Before demonstrating the project, run:

```powershell
# Terminal 1
cd backend
npm run dev

# Terminal 2
cd frontend
npm run dev
```

Then confirm:

1. [http://localhost:5000/api/health](http://localhost:5000/api/health) returns a successful JSON response.
2. [http://localhost:5173](http://localhost:5173) opens the portal.
3. You can sign in with a seeded account or register a local test account.
4. The Dashboard loads after sign-in.

For the full feature and database reference, see [README.md](README.md).
