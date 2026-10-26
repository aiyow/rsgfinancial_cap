// Browser and API deployments have independent roots; keep these copies identical.
export const RECEIPT_EXTENSIONS = ['.jpg', '.jpeg', '.jfif', '.png'];
export const RECEIPT_ACCEPT = RECEIPT_EXTENSIONS.join(',');
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
export const RECEIPT_TYPE_MESSAGE = 'Only JPEG/JPG (.jpg, .jpeg, .jfif) or PNG (.png) receipt images are accepted.';

export function receiptExtension(name) {
  if (typeof name !== 'string') return '';
  const extension = name.slice(name.lastIndexOf('.')).toLowerCase();
  return RECEIPT_EXTENSIONS.includes(extension) ? extension : '';
}

export function receiptFileError(file) {
  if (!file) return 'Choose a JPEG/JPG (.jpg, .jpeg, .jfif) or PNG (.png) receipt image first.';
  if (!receiptExtension(file.name)) return RECEIPT_TYPE_MESSAGE;
  if (!Number.isFinite(file.size) || file.size <= 0) return 'The receipt image is empty. Choose another image.';
  if (file.size > MAX_RECEIPT_BYTES) return 'Receipt images must be 5 MB or smaller.';
  return '';
}
