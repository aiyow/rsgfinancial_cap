import { useEffect, useRef, useState } from 'react'
import { Download, LoaderCircle, MailCheck, RefreshCw, ShieldCheck } from 'lucide-react'
import useAuth from '../hooks/useAuth'
import { apiFile, apiRequest } from '../services/api'

export default function ProtectedSoaDownload({ billId, enabled }) {
  const { token, user } = useAuth()
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [verificationBusy, setVerificationBusy] = useState(false)
  const controller = useRef(null)
  useEffect(() => () => controller.current?.abort(), [])
  const storageKey = `protected-soa:${user?.id}:${billId}`
  function savedKey() { try { return sessionStorage.getItem(storageKey) } catch { return null } }
  function remember(key) { try { if (key) sessionStorage.setItem(storageKey, key); else sessionStorage.removeItem(storageKey) } catch { /* Downloads work without session storage. */ } }
  const requestKey = useRef(null)

  async function download(fresh = false) {
    if (busy || !enabled) return
    setBusy(true); setFeedback({ message: 'Preparing your protected SOA and sending its password…' })
    const abort = new AbortController(); controller.current = abort
    if (fresh) { remember(null); requestKey.current = null }
    const key = requestKey.current || savedKey() || crypto.randomUUID()
    requestKey.current = key; remember(key)
    try {
      let data = await apiRequest(`/api/bills/${billId}/protected-exports`, { method: 'POST', token, headers: { 'Idempotency-Key': key }, signal: abort.signal })
      for (let attempt = 0; ['PREPARING', 'EMAIL_PENDING'].includes(data.status) && attempt < 90; attempt++) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(done, 2000)
          function done() { abort.signal.removeEventListener('abort', cancelled); resolve() }
          function cancelled() { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')) }
          abort.signal.addEventListener('abort', cancelled, { once: true })
        })
        data = await apiRequest(`/api/soa-exports/${data.exportId}`, { token, signal: abort.signal })
      }
      if (data.status !== 'READY') {
        const terminal = ['FAILED', 'EXPIRED'].includes(data.status)
        setFeedback({ error: data.message || (terminal ? 'This export expired. Create a fresh protected PDF.' : 'Your export is still processing. Try Download protected SOA again to check the same request.'), fresh: terminal })
        return
      }
      const blob = await apiFile(`/api/soa-exports/${data.exportId}/file`, { token, signal: abort.signal })
      const url = URL.createObjectURL(blob), link = document.createElement('a')
      link.href = url; link.download = data.filename; document.body.appendChild(link); link.click(); link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
      setFeedback({ message: 'Your protected SOA is ready. Check your email for its password.', maskedEmail: data.maskedEmail, reference: data.reference, ready: true })
    } catch (error) {
      if (abort.signal.aborted) return
      setFeedback({ error: error.message, verify: error.data?.code === 'EMAIL_VERIFICATION_REQUIRED', fresh: ['SOA_CHANGED', 'EXPORT_EXPIRED', 'EXPORT_NOT_READY'].includes(error.data?.code) })
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

  return <div className="w-full sm:w-auto">
    <button type="button" onClick={() => download(feedback?.fresh)} disabled={busy || !enabled} className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-60">
      {busy ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />} {busy ? 'Preparing protected SOA…' : 'Download protected SOA'}
    </button>
    {feedback && <div role={feedback.error ? 'alert' : 'status'} className={`mt-2 max-w-md rounded-lg border p-3 text-xs leading-5 ${feedback.error ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
      <p className="flex items-start gap-2"><ShieldCheck size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{feedback.error || feedback.message}</span></p>
      {feedback.maskedEmail && <p className="mt-1 break-all">Sent to {feedback.maskedEmail} · {feedback.reference}</p>}
      {feedback.ready && <><p className="mt-1">Download available for 15 minutes. Lost the password email?</p><button type="button" onClick={() => download(true)} disabled={busy} className="mt-1 inline-flex min-h-10 items-center gap-1 underline underline-offset-2"><RefreshCw size={13} aria-hidden="true" />Create a fresh PDF and password</button></>}
      {feedback.verify && <button type="button" onClick={verifyEmail} disabled={verificationBusy} className="mt-1 inline-flex min-h-10 items-center gap-1 underline underline-offset-2"><MailCheck size={14} aria-hidden="true" />{verificationBusy ? 'Sending verification…' : 'Send account verification link'}</button>}
    </div>}
  </div>
}
