import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Clock3 } from 'lucide-react'
import BrandMark from '../components/BrandMark'

export default function PendingApproval() {
  const [searchParams] = useSearchParams()
  const email = searchParams.get('email')
  const deliveryUnavailable = searchParams.get('delivery') === 'unavailable'

  return (
    <main className="verify-overlay-shell relative grid min-h-screen place-items-center overflow-hidden p-5">
      <div className="verify-backdrop" aria-hidden="true" />
      <section className="verify-modal relative z-10 w-full max-w-md rounded-2xl border border-white/80 bg-white p-7 text-center shadow-2xl sm:p-9">
        <div className="flex justify-center"><BrandMark size="lg" /></div>
        <div className="verify-icon-wrap"><Clock3 className="text-amber-600" size={29} aria-hidden="true" /></div>
        <h1 className="mt-4 text-xl font-black text-slate-900">Account awaiting approval</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">Your registration was sent for review.{email && <> We will notify <strong>{email}</strong> once it is approved.</>}</p>
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-left"><p className="text-sm font-black text-amber-950">Waiting for Admin approval</p><p className="mt-1 text-sm leading-6 text-amber-900">An Admin will review your account. You can sign in after approval.</p></div>
        <p className="mt-5 text-sm leading-6 text-slate-600">{deliveryUnavailable ? 'Email verification will be available once email sending is configured. ' : 'Want to activate it yourself? '}<Link to={`/verify-email${email ? `?email=${encodeURIComponent(email)}${deliveryUnavailable ? '&delivery=unavailable' : ''}` : ''}`} className="account-registration-link">Verify by email</Link></p>
        <Link to="/login" className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"><ArrowLeft size={17} />Return to sign in</Link>
      </section>
    </main>
  )
}
