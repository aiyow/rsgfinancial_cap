import crypto from "node:crypto";
import { v2 as cloudinary } from "cloudinary";

function configurationError() {
  const error = new Error("Cloudinary receipt storage is not configured.");
  error.code = "CLOUDINARY_NOT_CONFIGURED";
  return error;
}

export function createReceiptService({ client = cloudinary, environment = process.env, createId = crypto.randomUUID } = {}) {
  function settings() {
    const cloudName = environment.CLOUDINARY_CLOUD_NAME?.trim();
    const apiKey = environment.CLOUDINARY_API_KEY?.trim();
    const apiSecret = environment.CLOUDINARY_API_SECRET?.trim();
    const folder = (environment.CLOUDINARY_RECEIPTS_FOLDER || "rsg-condo/payment-receipts")
      .trim()
      .replace(/^\/+|\/+$/g, "");

    if (!cloudName || !apiKey || !apiSecret || !folder) throw configurationError();

    client.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
    return { folder };
  }

  function uploadReceipt(buffer) {
    const { folder } = settings();
    return new Promise((resolve, reject) => {
      const stream = client.uploader.upload_stream(
        {
          resource_type: "image",
          type: "authenticated",
          folder,
          public_id: createId(),
          unique_filename: false,
          overwrite: false,
        },
        (error, result) => {
          if (error) return reject(error);
          if (!result?.public_id) return reject(new Error("Cloudinary did not return a receipt public ID."));
          return resolve({ publicId: result.public_id });
        },
      );
      stream.end(buffer);
    });
  }

  async function destroyReceipt(publicId) {
    settings();
    if (!publicId) return { result: "not found" };
    return client.uploader.destroy(publicId, {
      resource_type: "image",
      type: "authenticated",
      invalidate: true,
    });
  }

  function receiptDeliveryUrl(publicId) {
    settings();
    if (!publicId) throw new Error("Cloudinary receipt public ID is missing.");
    return client.url(publicId, {
      resource_type: "image",
      type: "authenticated",
      sign_url: true,
      secure: true,
    });
  }

  return { uploadReceipt, destroyReceipt, receiptDeliveryUrl };
}

const receiptService = createReceiptService();
export const uploadReceipt = (...args) => receiptService.uploadReceipt(...args);
export const destroyReceipt = (...args) => receiptService.destroyReceipt(...args);
export const receiptDeliveryUrl = (...args) => receiptService.receiptDeliveryUrl(...args);
