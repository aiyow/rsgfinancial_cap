# Account limits

New passwords use 12–128 Unicode characters and require an uppercase letter,
a lowercase letter, a number, and a symbol. Password verification uses the full
input. New hashes use versioned, salted scrypt (N=16384, r=8, p=5); existing bcrypt
hashes remain supported until the password is changed. All current-password
checks accept long passwords, including email changes and privileged deletions.

Registration accepts first and last names of up to 100 characters each. MI stays
optional and follows `/^[A-Za-z]{1,2}\.?$/`. Complete-name storage supports 205
characters, including MI and spaces, in users and billing/audit/email snapshots.

For an existing database, run `npm run accounts:migrate-limits` in `backend/`
before enabling the updated application. Migration 038 is transactional,
idempotent, and only widens name columns; it does not change any account values
or existing password hashes. Fresh databases receive it through `npm run db:init`.
