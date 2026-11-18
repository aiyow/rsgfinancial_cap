# Unit resident names for SOAs

Deploy the database migration before the updated backend and frontend:

```sh
cd backend
npm run soa-names:migrate
```

The migration copies the current payer name once for each unit (primary payer
first, otherwise the first active assignment, matching the previous SOA generator).
Units without an active assignment start blank. Rerunning the migration does not
overwrite saved names or fill blank units from newly registered accounts.

Admin can edit **Resident Name** in **Financial Reports → Unit Occupancy**.
Click **Edit** above the table to enable the name fields, change the names, then
click the same button, now labeled **Save**, to save all changes together. **Cancel**
discards unsaved changes. Only resident names are editable there. Names
are required when editing and support up to 205 characters. They can name a
person or contain multiple names as needed. Staff without the Admin role can
view the saved names but cannot change them, including through the API.

Newly generated SOAs copy the saved unit name into their payer-name snapshot.
Existing statements, published or unpublished, retain their original names.
Blank templates display an unassigned-payer label on new SOAs until Admin saves
a name. Account names, assignments, email recipients, access permissions, and
protected PDF passwords continue to use the resident's account information.

Unit Occupancy printing and Excel export use the saved template names. Financial
rows for existing bills continue using their historical payer snapshots.

Run isolated migration/API/generation checks with `npm run test:soa-names`.
