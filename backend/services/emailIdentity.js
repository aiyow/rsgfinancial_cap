export function normalizeEmailIdentity(email) {
  return String(email ?? "").trim().toLowerCase();
}
