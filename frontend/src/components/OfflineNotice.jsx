import { useSyncExternalStore } from 'react'
import { WifiOff } from 'lucide-react'
import useAuth from '../hooks/useAuth'
import { getOfflineState, subscribeOffline } from '../services/residentOffline'

export default function OfflineNotice() {
  const { user } = useAuth()
  const { offline, savedAt } = useSyncExternalStore(subscribeOffline, getOfflineState)
  if (!offline || user.role !== 'RESIDENT') return null
  const saved = savedAt && new Date(savedAt).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
  return <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950 sm:text-sm">
    <WifiOff size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
    <div>
      <p className="font-bold">You’re offline. Viewing saved information.</p>
      <p>{saved ? `Saved information shown on this page dates from ${saved}.` : 'Only information saved on this device is available.'} Balances may have changed.</p>
      <p>Connect to upload receipts, make account changes, and get updates.</p>
    </div>
  </div>
}
