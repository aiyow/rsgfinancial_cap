export function formatLabel(value, fallback = '—') {
  if (value === null || value === undefined || String(value).trim() === '') return fallback

  return String(value)
    .trim()
    .replaceAll(/[_-]+/g, ' ')
    .toLocaleLowerCase()
    .replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase())
}
