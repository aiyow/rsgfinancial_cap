# Backend services

Related service code lives in one file per feature. Each consolidated file starts with a section index and uses `// #region` / `// #endregion` comments for editor folding.

| File | Contents |
| --- | --- |
| [accounts.js](accounts.js) | Email identity, email-change challenges, registration verification/quotas, and account eligibility safeguards. |
| [passwords.js](passwords.js) | Password policy, validation, hashing, recovery challenges, and password-reset emails. |
| [email.js](email.js) | Shared email styling, account verification messages, SOA notifications/attachments, delivery processing, and reminder scheduling. |
| [soa.js](soa.js) | SOA templates/assets, opening passwords, PDF rendering/encryption, authorized snapshots, email requests, and cooldowns. |
| [billing.js](billing.js) | Billing period/date rules, billing error support, meter validation, statement queries, and resident bill details. |
| [payments.js](payments.js) | Amount/allocation helpers, resident identity, recipient details, permissions, ledger entries, credits, penalties, and reconciliation. |
| [receipts.js](receipts.js) | Receipt file rules, text parsing, image quality/OCR, and private receipt storage. |
| [analytics.js](analytics.js) | Eligible history, usage anomalies, forecasting, recommendations, evaluation/comparison, guidance, and refresh jobs. |
| [spreadsheets.js](spreadsheets.js) | Spreadsheet compatibility and analytics workbook exports. |
| [financialReports.js](financialReports.js) | Financial report filters, collections, receivables, combined reports, and efficiency. |
| [notifications.js](notifications.js) | Transaction-aware resident/staff notification creation. |
| [audit.js](audit.js) | Safe snapshots, context, summaries, historical identities, logging, delivery outcomes, and route coverage. |

Import named functions directly from the feature file. Keep new helpers in the relevant section instead of creating another small service file. Business changes still belong in their existing transactions; this organization does not change HTTP endpoints, database tables, or the separate frontend/API deployment roots.

The browser password and receipt policy copies remain synchronized with the corresponding sections in `passwords.js` and `receipts.js`; existing tests check their source parity.
