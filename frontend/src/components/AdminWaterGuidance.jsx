import { useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Link } from 'react-router-dom'

const amount = value => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(value)
const volume = value => new Intl.NumberFormat('en-PH', { maximumFractionDigits: 3 }).format(value)
const month = value => new Date(`${value}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'short', year: 'numeric', timeZone: 'UTC' })

export default function AdminWaterGuidance({ guidance, title = 'Recommended admin actions', description, metric = 'both', showAnalyticsLink = true }) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const headingId = useId()
  const detailsId = useId()
  const comparison = guidance?.comparison
  const recommendations = metric === 'both' ? guidance?.recommendations : guidance?.chartInsights?.[metric]
  return <section aria-labelledby={headingId} className="mt-5 min-w-0 border-t border-[var(--border)] pt-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1 basis-52">
        <h3 id={headingId} className="text-sm font-black text-[var(--ink)]">{title}</h3>
        {description && <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{description}</p>}
        {guidance?.sourceMonth && <p className="mt-1 text-xs text-[var(--muted)]">{month(guidance.sourceMonth)} actual → {month(guidance.forecastMonth)} forecast{guidance.sourcePeriod?.periodType === 'HISTORICAL_ANALYTICS' ? ' · Based on historical readings' : ''}</p>}
      </div>
      <button type="button" aria-expanded={detailsOpen} aria-controls={detailsId} onClick={() => setDetailsOpen(open => !open)} className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs font-bold text-[var(--primary)] hover:bg-[var(--app-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]">
        {detailsOpen ? 'Hide details' : 'Show details'}<ChevronDown size={15} aria-hidden="true" className={detailsOpen ? 'rotate-180' : ''} />
      </button>
    </div>
    <div id={detailsId} hidden={!detailsOpen}>
    {!guidance ? <p className="mt-2 text-xs text-[var(--muted)]">Guidance is unavailable. Refresh the overview to load the latest water recommendations.</p> : <>
      {comparison?.actualConsumption !== null && comparison?.actualConsumption !== undefined && <div className="mt-3 rounded-lg bg-[var(--app-bg)] p-3 text-xs leading-5 text-[var(--ink)]">
        {metric !== 'bill' && <p className="font-bold">Same {guidance.coverage.comparableUnits} {guidance.coverage.comparableUnits === 1 ? 'unit' : 'units'}: {volume(comparison.actualConsumption)} → {volume(comparison.projectedConsumption)} m³</p>}
        {metric === 'consumption' && <p>Water-use forecasts are ready for {guidance.coverage.readyUnits} of {guidance.coverage.totalUnits} units.</p>}
        {metric !== 'consumption' && (comparison.actualWaterCharge !== null && comparison.projectedWaterCharge !== null ? <p>Comparable resident water charges: {amount(comparison.actualWaterCharge)} → {amount(comparison.projectedWaterCharge)}, using the source rate of {amount(guidance.sourcePeriod.waterRate)}/m³{metric === 'bill' ? ` for the same ${guidance.coverage.comparableUnits} ${guidance.coverage.comparableUnits === 1 ? 'unit' : 'units'}` : ''}.</p> : <p>Water-charge estimates are unavailable until a valid source water rate is recorded.</p>)}
        <p className="mt-1 text-[var(--muted)]">{metric === 'bill' ? "The chart may cover more units than this provisional charge estimate. Confirm the next period's readings and approved rate before final billing." : 'The comparison uses only units with valid source readings and ready forecasts; chart totals may cover a different set of units.'}</p>
      </div>}
      {recommendations ? <ul className="mt-3 space-y-3">
        {recommendations.slice(0, 3).map(item => <li key={item.key} className="min-w-0 rounded-lg border border-[var(--border)] bg-white p-3 text-xs leading-5 [overflow-wrap:anywhere]">
          <div className="flex items-start gap-2"><span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${item.priority === 'HIGH' ? 'bg-amber-500' : 'bg-[var(--primary)]'}`} /><h4 className="font-black text-[var(--ink)]">{item.title}</h4>{item.priority === 'HIGH' && <span className="ml-auto shrink-0 rounded bg-amber-50 px-1.5 text-[10px] font-bold text-amber-800">Priority</span>}</div>
          <p className="mt-1 text-[var(--muted)]">{item.condition}</p>
          <p className="mt-1 text-[var(--ink)]">{item.action}</p>
        </li>)}
      </ul> : <p className="mt-3 text-xs text-[var(--muted)]">Insights for this graph are unavailable. Refresh the overview to load the latest recommendations.</p>}
    </>}
    {showAnalyticsLink && <Link to="/admin/analytics" className="mt-3 inline-flex min-h-10 items-center gap-2 rounded text-xs font-bold text-[var(--primary)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]">Review Water Analytics <span aria-hidden="true">→</span></Link>}
    </div>
  </section>
}
