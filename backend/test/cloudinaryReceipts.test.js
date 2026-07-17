import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";
import { createReceiptService } from "../services/cloudinaryReceipts.js";

const environment = {
  CLOUDINARY_CLOUD_NAME: "test-cloud",
  CLOUDINARY_API_KEY: "test-key",
  CLOUDINARY_API_SECRET: "test-secret",
  CLOUDINARY_RECEIPTS_FOLDER: "/rsg-condo/payment-receipts/",
};

function clientDouble({ uploadResult = { public_id: "rsg-condo/payment-receipts/receipt-1" } } = {}) {
  const calls = { config: [], upload: [], destroy: [], url: [] };
  return {
    calls,
    config(options) { calls.config.push(options); },
    uploader: {
      upload_stream(options, callback) {
        calls.upload.push(options);
        return new Writable({
          write(_chunk, _encoding, done) { done(); },
          final(done) { callback(null, uploadResult); done(); },
        });
      },
      async destroy(publicId, options) {
        calls.destroy.push({ publicId, options });
        return { result: "ok" };
      },
    },
    url(publicId, options) {
      calls.url.push({ publicId, options });
      return "https://example.test/signed-receipt";
    },
  };
}

test("receipt upload uses authenticated Cloudinary storage", async () => {
  const client = clientDouble();
  const service = createReceiptService({ client, environment, createId: () => "receipt-1" });

  const result = await service.uploadReceipt(Buffer.from("image"));

  assert.deepEqual(result, { publicId: "rsg-condo/payment-receipts/receipt-1" });
  assert.deepEqual(client.calls.upload[0], {
    resource_type: "image",
    type: "authenticated",
    folder: "rsg-condo/payment-receipts",
    public_id: "receipt-1",
    unique_filename: false,
    overwrite: false,
  });
});

test("receipt delivery remains signed and authenticated", async () => {
  const client = clientDouble();
  const service = createReceiptService({ client, environment });

  assert.equal(service.receiptDeliveryUrl("folder/receipt"), "https://example.test/signed-receipt");
  await service.destroyReceipt("folder/receipt");

  assert.deepEqual(client.calls.url[0], {
    publicId: "folder/receipt",
    options: { resource_type: "image", type: "authenticated", sign_url: true, secure: true },
  });
  assert.deepEqual(client.calls.destroy[0], {
    publicId: "folder/receipt",
    options: { resource_type: "image", type: "authenticated", invalidate: true },
  });
});

test("missing Cloudinary credentials fail without attempting an upload", () => {
  const client = clientDouble();
  const service = createReceiptService({ client, environment: {} });

  assert.throws(() => service.uploadReceipt(Buffer.from("image")), { code: "CLOUDINARY_NOT_CONFIGURED" });
  assert.equal(client.calls.upload.length, 0);
});
