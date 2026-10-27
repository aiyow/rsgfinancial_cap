import { useCallback, useEffect, useRef, useState } from 'react'
import { Mail, LoaderCircle, MailCheck } from 'lucide-react'
import useAuth from '../hooks/useAuth'
import { apiRequest } from '../services/api'

async function waitForEmail(data, token, signal) {
  for (let attempt = 0; ['PREPARING', 'EMAIL_PENDING'].includes(data.status) && attempt < 90; attempt++) {
    await new Promise((resolve, reject) => {
      if (signal.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return }
      const timer = setTimeout(done, 2000)
      function done() { signal.removeEventListener('abort', cancelled); resolve() }
      function cancelled() { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')) }
      signal.addEventListener('abort', cancelled, { once: true })
    })
    data = await apiRequest(`/api/soa-exports/${data.exportId}`, { token, signal })
  }
  return data
}

export default function ProtectedSoaDownload({ billId, enabled }) {
  const { token, user } = useAuth()
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(true)
  const [sentUntil, setSentUntil] = useState(0)
  const [feedback, setFeedback] = useState(null)
  const [verificationBusy, setVerificationBusy] = useState(false)
  const controller = useRef(null)
  const requestKey = useRef(null)
  useEffect(() => () => controller.current?.abort(), [])
  const storageKey = `soa-email-request:${user?.id}:${billId}`
  function savedKey() { try { return sessionStorage.getItem(storageKey) } catch { return null } }
  function remember(key) { try { if (key) sessionStorage.setItem(storageKey, key); else sessionStorage.removeItem(storageKey) } catch { /* Requests work without session storage. */ } }

  const markSent = useCallback(data => {
    const deadline = Date.parse(data.nextRequestAt)
    setSentUntil(Number.isFinite(deadline) && deadline > Date.now() ? deadline : 0)
    setFeedback(null)
    requestKey.current = null
    try { sessionStorage.removeItem(storageKey) } catch { /* Server enforces the cooldown. */ }
  }, [storageKey])

  useEffect(() => {
    if (!sentUntil) return undefined
    const timer = setTimeout(() => setSentUntil(0), Math.max(0, sentUntil - Date.now()))
    return () => clearTimeout(timer)
  }, [sentUntil])

  useEffect(() => {
    const abort = new AbortController()
    async function check() {
      try {
        if (!enabled) return
        let data = await apiRequest(`/api/bills/${billId}/protected-exports`, { token, signal: abort.signal })
        if (['PREPARING', 'EMAIL_PENDING'].includes(data.status)) {
          setBusy(true)
          data = await waitForEmail(data, token, abort.signal)
        }
        if (abort.signal.aborted) return
        if (data.status === 'READY') markSent(data)
        else if (data.status === 'AVAILABLE') {
          requestKey.current = null
          try { sessionStorage.removeItem(storageKey) } catch { /* Optional retry persistence. */ }
        }
      } catch { /* The request action reports errors; checking never sends email. */ }
      finally { if (!abort.signal.aborted) { setChecking(false); setBusy(false) } }
    }
    check()
    return () => abort.abort()
  }, [billId, enabled, token, markSent, storageKey])

  async function requestSoa() {
    if (busy || checking || sentUntil || !enabled) return
    setBusy(true); setFeedback(null)
    const abort = new AbortController(); controller.current = abort
    if (feedback?.fresh) { remember(null); requestKey.current = null }
    const key = requestKey.current || savedKey() || crypto.randomUUID()
    requestKey.current = key; remember(key)
    try {
      const response = await apiRequest(`/api/bills/${billId}/protected-exports`, { method: 'POST', token, headers: { 'Idempotency-Key': key }, signal: abort.signal })
      const data = await waitForEmail(response, token, abort.signal)
      if (data.status !== 'READY') {
        setFeedback({ error: data.message || 'SOA email is still processing. Please try again shortly.', fresh: ['FAILED', 'EXPIRED'].includes(data.status) })
        return
      }
      markSent(data)
    } catch (error) {
      if (abort.signal.aborted) return
      if (error.data?.code === 'SOA_EMAIL_COOLDOWN') {
        markSent({ nextRequestAt: error.data.nextRequestAt || new Date(Date.now() + Number(error.data.retryAfterSeconds || 1800) * 1000).toISOString() })
      } else setFeedback({ error: error.message, verify: error.data?.code === 'EMAIL_VERIFICATION_REQUIRED', fresh: ['SOA_CHANGED', 'EXPORT_EXPIRED', 'EXPORT_NOT_READY'].includes(error.data?.code) })
    } finally { if (!abort.signal.aborted) setBusy(false) }
  }

  async function verifyEmail() {
    setVerificationBusy(true)
    try {
      const data = await apiRequest('/api/auth/resend-verification', { method: 'POST', body: { email: user.email } })
      setFeedback({ verify: true, message: data.message })
    } catch (error) { setFeedback({ verify: true, error: error.message }) }
    finally { setVerificationBusy(false) }
  }

  const sent = Boolean(sentUntil)
  const hint = sent ? 'Check Inbox or Spam. You can request another copy after 30 minutes.' : 'Email a protected copy of this SOA.'
  return <div className="w-full sm:w-auto" title={hint}>
    <button type="button" onClick={requestSoa} disabled={busy || checking || sent || !enabled} aria-live="polite" className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-60">
      {busy || checking ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : sent ? <MailCheck size={16} aria-hidden="true" /> : <Mail size={16} aria-hidden="true" />}
      {busy ? 'Sending SOA…' : checking ? 'Checking SOA…' : sent ? 'SOA already sent in email' : 'Request SOA'}
    </button>
    {feedback && !sent && <div role={feedback.error ? 'alert' : 'status'} className="mt-2 max-w-xs rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
      <p>{feedback.error || feedback.message}</p>
      {feedback.verify && <button type="button" onClick={verifyEmail} disabled={verificationBusy} className="mt-1 inline-flex min-h-10 items-center gap-1 underline underline-offset-2"><MailCheck size={14} aria-hidden="true" />{verificationBusy ? 'Sending verification…' : 'Send account verification link'}</button>}
    </div>}
  </div>
}
