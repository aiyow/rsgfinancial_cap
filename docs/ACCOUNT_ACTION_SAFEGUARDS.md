# Account action safeguards

User Management requests fresh Admin-only eligibility from `GET /api/users/:id/action-eligibility` whenever Delete or Deactivate opens. Both actions fail closed during loading or when the check fails. The response includes open assignments, action permissions and reasons, required category balances for unpaid published SOAs, the total, and privileged deletion password requirements.

Deletion requires all assignments to have a non-null `end_date`, even when the unit is fully paid or the assignment starts in the future. Successful deletion atomically removes the account, ended assignment history and reports submitted by that account. Existing authorization, self-account restrictions and current Admin password confirmation remain in effect.

Only an active Resident's transition to inactive checks financial balances. Every published SOA on currently open assignments is considered, including old bills and bills whose due dates have not passed. Tenants require water to be settled; owners require water and association dues including applicable penalties. Only approved payments actually applied to those categories count, regardless of the submitter. Drafts, unpublished SOAs and former-unit debts do not block the action.

Unassignment is allowed with debt. It does not remove the unit's bills or balances. Paid deactivation retains the resident's assignments and records.

The final mutations recheck inside transactions. Assignment changes and deactivation serialize using user `FOR NO KEY UPDATE` locks; deletion retains `FOR UPDATE`. Deactivation locks current units in ascending order before refreshing relevant penalties and checking balances. Publication participates in the same unit locks as payment approvals and bill corrections. Preflight computes penalties without writing them. A failed final action rolls its penalty refresh back with the rest of the transaction.

No database migration is needed.

## Validation

- Backend: `npm test`, `npm run test:account-safeguards`, `npm run test:user-deletion`.
- Assignment compatibility: `node --test test/integration/unitOccupancyHttp.test.js`.
- Frontend: `npm test`, `npm run build`, targeted ESLint for the changed components.
- Mocked browser checks: run `node test/browser/accountActions.mjs` from frontend with Vite running. Set `PLAYWRIGHT_MODULE` to an existing Playwright module path if it is not locally installed. Optional `FRONTEND_URL` defaults to the local User Management page.

The account safeguard integration suite creates and drops only a randomly named disposable schema. It uses direct PostgreSQL connections (removing Neon's pooler hostname suffix) and startup search-path settings, with assertions refusing fixture queries outside that namespace. A transaction pooler cannot safely retain session search paths between transactions. The tests use real HTTP and constraints plus concurrent transactions, and never mutate real accounts. Browser checks mock every API call and cover loading, errors/retry, blockers, stale conflicts, successful actions, privileged password confirmation, focus handling and desktop/mobile layouts.
