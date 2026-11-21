const databaseName = 'condo_sign_in'
const storeName = 'trusted_browsers'

function accountKey(email) {
  return email.trim().toLowerCase()
}

async function withBrowserStore(mode, operation) {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(storeName)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode)
      const request = operation(transaction.objectStore(storeName))
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function readTrustedBrowser(email) {
  try {
    return await withBrowserStore('readonly', store => store.get(accountKey(email)))
  } catch {
    return null
  }
}

export async function createTrustedBrowser() {
  try {
    const { privateKey, publicKey } = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'],
    )
    return { privateKey, publicKey: base64Url(await crypto.subtle.exportKey('spki', publicKey)) }
  } catch {
    return null
  }
}

export async function saveTrustedBrowser(email, id, privateKey) {
  try {
    await withBrowserStore('readwrite', store => store.put({ id, privateKey }, accountKey(email)))
  } catch {
    // Sign-in can continue if the browser denies persistent storage.
  }
}

export async function signTrustedBrowserChallenge(browser, challengeId) {
  const challenge = new TextEncoder().encode(`residens-trusted-browser:${challengeId}`)
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, browser.privateKey, challenge)
  return base64Url(signature)
}
