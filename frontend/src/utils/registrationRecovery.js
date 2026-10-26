const storageKey = 'condo_registration_verification'

export function clearRegistrationRecovery() {
  try { sessionStorage.removeItem(storageKey) } catch { /* Storage is optional. */ }
}

export function readRegistrationRecovery() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey))
    if (!saved || typeof saved.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(saved.email)
      || typeof saved.id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(saved.id)
      || !Number.isFinite(saved.expiresAt) || saved.expiresAt <= Date.now() || !Number.isFinite(saved.retryAt)) {
      clearRegistrationRecovery()
      return null
    }
    return { email:saved.email, id:saved.id, expiresAt:saved.expiresAt, retryAt:saved.retryAt }
  } catch { clearRegistrationRecovery(); return null }
}

export function saveRegistrationRecovery(email, result) {
  // Only non-secret challenge metadata. Never persist OTPs, passwords or signup grants.
  const saved = { email:email.trim().toLowerCase(), id:result.challengeId,
    expiresAt:result.expiresAt ? new Date(result.expiresAt).getTime() : Date.now()+10*60*1000,
    retryAt:Date.now()+Math.max(0,Number(result.retryAfterSeconds ?? 60))*1000 }
  try { sessionStorage.setItem(storageKey,JSON.stringify(saved)) } catch { /* In-memory verification still works. */ }
  return saved
}
