# Receipt OCR and two-image uploads

Residents choose the bank or app that issued the receipt and upload one or two
screenshots of the same payment. Each JPEG/JFIF or PNG image can be up to 5 MB.
The transferred amount excludes bank fees. OCR assists Admin review and does not
approve a payment automatically.

## Deploy

1. Install the updated backend dependencies. From the backend directory with
   the intended database configured, apply both migrations in order:

   ```sh
   npm run receipts:migrate-images
   npm run receipts:migrate-ocr
   ```

   These commands are safe to rerun. Migration 045 adds the ordered image table
   and backfills existing uploaded receipts as image 1. Migration 047 adds the
   OCR queue fields. Existing OCR results and payment review decisions are preserved.
2. Deploy the updated backend. The OCR worker starts with the API and can resume
   unfinished jobs after a restart.
3. Deploy the frontend. Older installed clients can still send one image without
   a receipt type. The backend uses Other and the general parser.

No new OCR service credentials are required. The implementation uses the existing
Tesseract, Sharp and private Cloudinary configuration.

Residents submit directly after selecting their receipt images. The API
validates and saves the original images and returns once the pending payment is
committed. The worker then reads the private images, runs OCR with its existing
rereads, and saves the detected fields. In Payment Verification, Admin can enter
values while OCR is queued or processing. Results fill only untouched inputs.
An OCR failure still leaves the receipt available for manual review.

## Interfaces and storage

- Preview and submission use repeated multipart `receipt` fields (one or two),
  `receiptType` (`GCASH`, `GOTYME`, `MARIBANK`, `BDO`, `BPI`, `MAYA`, `OTHER`), and
  the existing `paymentPurpose` field.
- `analysis` includes combined fields, `images`, `warnings`, `detectedReceiptType`
  and `additionalReferences`. Conflicting values remain empty for Admin review.
- Payment details include ordered `receiptImages` metadata, `ocrStatus` and `ocrDetails`.
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
