const storageKey = 'condo_password_recovery'

export function readPasswordRecovery() {
  try {
    const recovery = JSON.parse(sessionStorage.getItem(storageKey))
    return recovery?.email && recovery?.challengeId ? recovery : null
  } catch {
    return null
  }
}

export function savePasswordRecovery(email, result) {
  const recovery = {
    email: email.trim().toLowerCase(),
    challengeId: result.challengeId,
    resendAt: Date.now() + (result.retryAfterSeconds || 60) * 1000,
  }
  try { sessionStorage.setItem(storageKey, JSON.stringify(recovery)) } catch { /* Navigation state still works without storage. */ }
  return recovery
}

export function clearPasswordRecovery() {
  try { sessionStorage.removeItem(storageKey) } catch { /* Storage can be unavailable. */ }
}
