# Receipt OCR and two-image uploads

Residents choose the bank or app that issued the receipt and upload one or two
screenshots of the same payment. Each JPEG/JFIF or PNG image can be up to 5 MB.
The transferred amount excludes bank fees. OCR assists Admin review and does not
approve a payment automatically.

## Deploy

1. Install the updated backend dependencies and deploy the backend code. The
   PostgreSQL emulator is a development dependency used only by tests.
2. Apply migration 045 to the intended database before using the updated payment
   pages. From the backend directory, or the deployed backend service shell, run:

   ```sh
   npm run receipts:migrate-images
   ```

   This command is safe to rerun. It adds receipt type/OCR metadata and an ordered
   image table, then backfills existing uploaded receipts as image 1. Existing
   payment amounts, references, review decisions and allocations are preserved.
   Where a deployment system supports a migration phase, run this command there
   before the new backend starts serving payment requests.
3. Deploy the frontend after the backend and migration are ready. Older installed
   clients can still send one image without a receipt type; the backend uses Other
   and the general parser. The existing first-image endpoint remains available.

No new OCR service credentials are required. The implementation uses the existing
Tesseract, Sharp and private Cloudinary configuration.

## Interfaces and storage

- Preview and submission use repeated multipart `receipt` fields (one or two),
  `receiptType` (`GCASH`, `GOTYME`, `MARIBANK`, `BDO`, `BPI`, `MAYA`, `OTHER`), and
  the existing `paymentPurpose` field.
- `analysis` includes combined fields, `images`, `warnings`, `detectedReceiptType`
  and `additionalReferences`. Conflicting values remain empty for Admin review.
- Payment details include ordered `receiptImages` metadata and `ocrDetails`.
  Images are fetched through authenticated
  `GET /api/payments/:id/receipts/:imageId`; `GET /api/payments/:id/receipt` still
  returns the first image. Image IDs must belong to the authorized payment.
- Each image has its own unique content hash. Reversing image order or uploading
  an already-submitted second image does not bypass duplicate checks.
- Legacy first-image columns remain synchronized. The local-to-Cloudinary
  migration script updates the backfilled first-image row transactionally.

## Verify

With development dependencies installed, run these from the backend directory:

```sh
npm test
npm run test:receipt-images
```

The receipt integration test uses an isolated in-memory PostgreSQL database and
mocked Cloudinary transport. It runs real migrations, authentication, multipart
validation and OCR without accessing the live database or receipt storage.

Frontend verification includes `npm test`, `npm run build`, and these Playwright
scripts against the local frontend server:

```sh
node test/browser/receiptBatches.mjs
node test/browser/receiptFeedback.mjs
node test/browser/receiptViewer.mjs
```

`PLAYWRIGHT_MODULE` can identify an externally installed Playwright module, and
`TEST_BASE_URL` selects the server for the batch/feedback checks. Browser requests
and receipt images are fixtures. The supplied personal receipt images are not
included in committed tests.
