import multer from 'multer';
import sharp from 'sharp';
import { MAX_RECEIPT_BYTES, RECEIPT_TYPE_MESSAGE, receiptExtension, receiptFileError } from '../services/receiptFilePolicy.js';

function invalidReceipt(message) {
  return Object.assign(new Error(message), { status: 400 });
}

const receiveReceipt = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_RECEIPT_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    const accepted = Boolean(receiptExtension(file.originalname));
    callback(accepted ? null : invalidReceipt(RECEIPT_TYPE_MESSAGE), accepted);
  },
}).single('receipt');

async function validateReceipt(file) {
  const error = receiptFileError(file && { name: file.originalname, size: file.buffer.length });
  if (error) throw invalidReceipt(error);
  const extension = receiptExtension(file.originalname);
  const expectedFormat = extension === '.png' ? 'png' : 'jpeg';
  try {
    const image = sharp(file.buffer);
    const metadata = await image.metadata();
    if (metadata.format !== expectedFormat) {
      throw new Error('The image format does not match its extension.');
    }
    // Decode the pixels as well: a forged signature or damaged header is not an image.
    await image.stats();
  } catch {
    throw invalidReceipt('The file must contain a readable JPEG/JPG or PNG image matching its extension. Renaming another file does not convert it to an image.');
  }
  // Client-supplied MIME types can be blank, incorrect, or forged (especially for JFIF).
  file.mimetype = expectedFormat === 'png' ? 'image/png' : 'image/jpeg';
}

// Both OCR preview and final submission must pass the same validation first.
export function receiptUpload(req, res, next) {
  receiveReceipt(req, res, error => {
    if (error) {
      if (error.code === 'LIMIT_FILE_SIZE') error.message = 'Receipt images must be 5 MB or smaller.';
      return next(error);
    }
    return validateReceipt(req.file).then(() => next(), next);
  });
}
