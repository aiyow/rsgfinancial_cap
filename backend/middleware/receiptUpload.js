import multer from 'multer';
import sharp from 'sharp';
import {
  MAX_RECEIPT_BYTES,
  MAX_RECEIPT_IMAGES,
  RECEIPT_TYPE_MESSAGE,
  receiptExtension,
  receiptFileError,
} from "../services/receipts.js";

function invalidReceipt(message) {
  return Object.assign(new Error(message), { status: 400 });
}

const receiveReceipt = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_RECEIPT_BYTES, files: MAX_RECEIPT_IMAGES, fields: 4, fieldSize: 1024 },
  fileFilter: (_req, file, callback) => {
    const accepted = Boolean(receiptExtension(file.originalname));
    callback(accepted ? null : invalidReceipt(RECEIPT_TYPE_MESSAGE), accepted);
  },
}).array('receipt', MAX_RECEIPT_IMAGES);

async function validateReceipt(file) {
  const error = receiptFileError(file && { name: file.originalname, size: file.buffer.length });
  if (error) throw invalidReceipt(error);
  const extension = receiptExtension(file.originalname);
  let format;
  try {
    const image = sharp(file.buffer);
    const metadata = await image.metadata();
    format = metadata.format;
    if (format !== 'png' && format !== 'jpeg') {
      throw new Error('Unsupported image format.');
    }
    // Decode the pixels as well: a forged signature or damaged header is not an image.
    await image.stats();
  } catch {
    throw invalidReceipt('The file must contain a readable JPEG/JPG or PNG image. Choose a valid receipt image.');
  }
  // Messaging apps can give a JPEG image a PNG filename (or the reverse).
  const expectedFormat = extension === '.png' ? 'png' : 'jpeg';
  if (format !== expectedFormat) {
    file.originalname = file.originalname.slice(0, -extension.length) + (format === 'png' ? '.png' : '.jpg');
  }
  // Client-supplied MIME types can be blank, incorrect, or forged (especially for JFIF).
  file.mimetype = format === 'png' ? 'image/png' : 'image/jpeg';
}

// Both OCR preview and final submission must pass the same validation first.
export function receiptUpload(req, res, next) {
  receiveReceipt(req, res, error => {
    if (error) {
      if (error.code === 'LIMIT_FILE_SIZE') error.message = 'Receipt images must be 5 MB or smaller.';
      if (['LIMIT_FILE_COUNT', 'LIMIT_UNEXPECTED_FILE'].includes(error.code)) error.message = 'Choose one or two receipt images only.';
      return next(error);
    }
    if (!req.files?.length) return next(invalidReceipt('Choose one or two receipt images first.'));
    // Keep req.file available to existing single-image consumers.
    req.file = req.files[0];
    return Promise.all(req.files.map(validateReceipt)).then(() => next(), next);
  });
}
