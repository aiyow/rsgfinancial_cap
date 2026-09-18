import crypto from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';

function configurationError() {
  const error = new Error('Cloudinary SOA asset storage is not configured.');
  error.code = 'CLOUDINARY_NOT_CONFIGURED';
  return error;
}

export function createSoaAssetService({ client = cloudinary, environment = process.env, createId = crypto.randomUUID } = {}) {
  function settings() {
    const cloudName = environment.CLOUDINARY_CLOUD_NAME?.trim();
    const apiKey = environment.CLOUDINARY_API_KEY?.trim();
    const apiSecret = environment.CLOUDINARY_API_SECRET?.trim();
    const folder = (environment.CLOUDINARY_SOA_ASSETS_FOLDER || 'rsg-condo/soa-assets').trim().replace(/^\/+|\/+$/g, '');
    if (!cloudName || !apiKey || !apiSecret || !folder) throw configurationError();
    client.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
    return { folder };
  }

  function uploadAsset(buffer, assetType) {
    const { folder } = settings();
    return new Promise((resolve, reject) => {
      const stream = client.uploader.upload_stream({
        resource_type: 'image', type: 'authenticated', folder,
        public_id: `${assetType}-${createId()}`, unique_filename: false, overwrite: false,
      }, (error, result) => {
        if (error) return reject(error);
        if (!result?.public_id) return reject(new Error('Cloudinary did not return an SOA asset ID.'));
        return resolve({ publicId: result.public_id });
      });
      stream.end(buffer);
    });
  }

  async function destroyAsset(publicId) {
    settings();
    if (!publicId) return { result: 'not found' };
    return client.uploader.destroy(publicId, { resource_type: 'image', type: 'authenticated', invalidate: true });
  }

  function deliveryUrl(publicId) {
    settings();
    if (!publicId) throw new Error('SOA asset ID is missing.');
    return client.url(publicId, { resource_type: 'image', type: 'authenticated', sign_url: true, secure: true });
  }

  return { uploadAsset, destroyAsset, deliveryUrl };
}

const assetService = createSoaAssetService();
export const uploadSoaAsset = (...args) => assetService.uploadAsset(...args);
export const destroySoaAsset = (...args) => assetService.destroyAsset(...args);
export const soaAssetDeliveryUrl = (...args) => assetService.deliveryUrl(...args);
