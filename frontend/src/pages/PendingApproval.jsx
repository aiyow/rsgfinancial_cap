import { Link, useSearchParams } from 'react-router-dom'
import { Clock3 } from 'lucide-react'
import BrandMark from '../components/BrandMark'

export default function PendingApproval() {
  const [searchParams] = useSearchParams()
  const email = searchParams.get('email')

  return (
    <main className="verify-overlay-shell relative grid min-h-screen place-items-center overflow-hidden p-5">
      <div className="verify-backdrop" aria-hidden="true" />
      <section className="verify-modal relative z-10 w-full max-w-md rounded-2xl border border-white/80 bg-white p-7 text-center shadow-2xl sm:p-9">
        <div className="flex justify-center"><BrandMark size="lg" /></div>
        <div className="verify-icon-wrap"><Clock3 className="text-amber-600" size={29} aria-hidden="true" /></div>
        <h1 className="mt-4 text-xl font-black text-slate-900">Account awaiting approval</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">Your registration was sent to an administrator for review.{email && <> We will approve the account for <strong>{email}</strong> once it has been verified.</>}</p>
        <p className="mt-3 text-sm leading-6 text-slate-600">You can sign in after the administrator approves your account.</p>
        <Link to="/login" className="mt-6 inline-flex items-center justify-center rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#237147]">Back to sign in</Link>
      </section>
    </main>
  )
}
