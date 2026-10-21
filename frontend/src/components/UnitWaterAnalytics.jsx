import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { EmptyRow } from './DashboardLayout'
import { apiRequest } from '../services/api'
import { buildUnitWaterAnalytics } from '../utils/unitWaterAnalytics'
import { currency } from '../utils/chargePayments'

const selectClass = 'min-h-10 w-full min-w-0 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-emerald-100'
const retryClass = 'mt-3 min-h-11 rounded-lg border border-emerald-300 bg-white px-4 py-2 text-sm font-bold text-emerald-800 hover:bg-emerald-50'
const consumption = value => value === null || value === undefined ? 'Unavailable' : `${Number(value).toLocaleString('en-PH', { maximumFractionDigits: 3 })} m³`
const amount = value => value === null || value === undefined ? 'Unavailable' : currency(value)

export default function UnitWaterAnalytics({ token, refreshKey = 0 }) {
  const [units, setUnits] = useState([])
  const [selectedUnitId, setSelectedUnitId] = useState('')
  const [range, setRange] = useState('6')
  const [metric, setMetric] = useState('bill')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    apiRequest('/api/units', { token }).then(({ units: records = [] }) => {
      if (!active) return
      const sorted = [...records].sort((a, b) => String(a.unitNumber).localeCompare(String(b.unitNumber), undefined, { numeric: true }))
      setUnits(sorted)
      setSelectedUnitId(current => sorted.some(unit => String(unit.id) === current) ? current : String(sorted[0]?.id || ''))
    }).catch(error => { if (active) setError(error.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token, attempt])

  const selectedUnit = units.find(unit => String(unit.id) === selectedUnitId)
  function retry() { setError(''); setLoading(true); setAttempt(current => current + 1) }

  return <section id="unit-water-analytics" aria-labelledby="unit-water-title" className="min-w-0 scroll-mt-20 rounded-2xl border border-[var(--border)] bg-white p-4 shadow-sm sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 id="unit-water-title" className="text-base font-bold text-[var(--ink)]">Per-unit water analytics</h2>
        <p className="mt-0.5 text-xs text-[var(--muted)]">Water charges and usage by unit.</p>
      </div>
      {!loading && !error && units.length > 0 && <div className="grid w-full grid-cols-[minmax(0,1fr)_140px] gap-2 sm:w-auto sm:grid-cols-[190px_150px]">
        <UnitPicker units={units} selectedUnit={selectedUnit} onChange={setSelectedUnitId} />
        <MonthRangePicker value={range} onChange={setRange} />
      </div>}
    </div>
    <div className="mt-4">
      {loading ? <p role="status" className="text-sm text-[var(--muted)]">Loading units...</p>
        : error ? <div role="alert"><p className="text-sm text-red-700">{error}</p><button type="button" onClick={retry} className={retryClass}>Retry loading units</button></div>
        : !units.length ? <EmptyRow message="No units are available yet. Add a unit in Unit Management to get started." />
        : selectedUnit && <UnitWaterHistory key={`${selectedUnitId}:${refreshKey}`} unit={selectedUnit} token={token} range={range} metric={metric} onMetricChange={setMetric} />}
    </div>
  </section>
}

const historyRanges = [
  { value: '3', label: 'Last 3 months' },
  { value: '6', label: 'Last 6 months' },
  { value: '12', label: 'Last 12 months' },
  { value: 'ALL', label: 'All history' },
]

function MonthRangePicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const buttonRef = useRef(null)
  const optionRefs = useRef([])
  const listId = useId()
  const selected = historyRanges.find(option => option.value === value) || historyRanges[1]

  useEffect(() => {
    if (!open) return undefined
    optionRefs.current[historyRanges.findIndex(option => option.value === value)]?.focus()
    function closeOutside(event) { if (!rootRef.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('mousedown', closeOutside)
    return () => document.removeEventListener('mousedown', closeOutside)
  }, [open, value])

  function choose(nextValue) {
    onChange(nextValue)
    setOpen(false)
    buttonRef.current?.focus()
  }
  function keyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      buttonRef.current?.focus()
    }
    if (!open || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const current = optionRefs.current.indexOf(document.activeElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? historyRanges.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + historyRanges.length) % historyRanges.length
    optionRefs.current[next]?.focus()
  }

  return <div ref={rootRef} className="relative min-w-0" onKeyDown={keyDown} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    <button ref={buttonRef} type="button" aria-label="Unit chart history" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen(current => !current)} onKeyDown={event => { if (!open && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setOpen(true) } }} className={`${selectClass} flex items-center justify-between gap-2 text-left font-semibold transition hover:border-emerald-300 hover:bg-emerald-50/50 ${open ? 'border-emerald-400' : ''}`}>
      <span className="truncate">{selected.label}</span><ChevronDown size={15} aria-hidden="true" className={`shrink-0 text-[var(--muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div id={listId} role="listbox" aria-label="Chart history range" className="absolute right-0 top-[calc(100%+6px)] z-40 w-44 min-w-full rounded-xl border border-[var(--border)] bg-white p-1.5 shadow-lg">
      {historyRanges.map((option, index) => <button key={option.value} ref={element => { optionRefs.current[index] = element }} type="button" role="option" aria-selected={value === option.value} tabIndex={-1} onClick={() => choose(option.value)} className={`flex min-h-10 w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-xs font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-300 ${value === option.value ? 'bg-emerald-50 text-emerald-800' : 'text-[var(--ink)] hover:bg-slate-50 focus:bg-slate-50'}`}>
        <span>{option.label}</span>{value === option.value && <Check size={14} aria-hidden="true" className="shrink-0 text-emerald-700" />}
      </button>)}
    </div>}
  </div>
}

function UnitPicker({ units, selectedUnit, onChange }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const rootRef = useRef(null)
  const inputRef = useRef(null)
  const buttonRef = useRef(null)
  const optionRefs = useRef([])
  const listId = useId()
  const matches = units.filter(unit => `Unit ${unit.unitNumber} Floor ${unit.floor || ''}`.toLowerCase().includes(query.trim().toLowerCase()))

  useEffect(() => {
    if (!open) return undefined
    inputRef.current?.focus()
    function closeOutside(event) { if (!rootRef.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('mousedown', closeOutside)
    return () => document.removeEventListener('mousedown', closeOutside)
  }, [open])

  function choose(unit) {
    onChange(String(unit.id))
    setOpen(false)
    buttonRef.current?.focus()
  }
  function keyDown(event) {
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); buttonRef.current?.focus() }
    if (event.key === 'Enter' && matches[highlighted]) { event.preventDefault(); choose(matches[highlighted]) }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = Math.max(0, Math.min(matches.length - 1, highlighted + (event.key === 'ArrowDown' ? 1 : -1)))
      setHighlighted(next)
      optionRefs.current[next]?.scrollIntoView({ block: 'nearest' })
    }
  }

  return <div ref={rootRef} className="relative min-w-0" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    <button ref={buttonRef} type="button" aria-label="Select unit" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => { setQuery(''); setHighlighted(0); setOpen(current => !current) }} className={`${selectClass} flex items-center justify-between gap-2 text-left`}>
      <span className="truncate font-semibold">Unit {selectedUnit?.unitNumber}</span><ChevronDown size={15} aria-hidden="true" className="shrink-0 text-[var(--muted)]" />
    </button>
    {open && <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-full min-w-[180px] rounded-xl border border-[var(--border)] bg-white p-2 shadow-lg">
      <div className="relative"><Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
        <input ref={inputRef} type="search" role="combobox" aria-label="Search units" aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-activedescendant={matches[highlighted] ? `${listId}-${matches[highlighted].id}` : undefined} value={query} onChange={event => { setQuery(event.target.value); setHighlighted(0) }} onKeyDown={keyDown} placeholder="Search unit or floor" className="min-h-10 w-full min-w-0 rounded-lg border border-[var(--border)] py-2 pl-8 pr-2 text-xs outline-none focus:border-[var(--primary)]" />
      </div>
      <div id={listId} role="listbox" aria-label="Units" className="mt-1 max-h-48 overflow-y-auto overscroll-contain">
        {matches.map((unit, index) => <button ref={element => { optionRefs.current[index] = element }} key={unit.id} id={`${listId}-${unit.id}`} type="button" role="option" aria-selected={String(unit.id) === String(selectedUnit?.id)} tabIndex={-1} onMouseDown={event => event.preventDefault()} onClick={() => choose(unit)} className={`flex min-h-10 w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs ${String(unit.id) === String(selectedUnit?.id) ? 'bg-emerald-50 font-bold text-emerald-800' : index === highlighted ? 'bg-slate-50 text-[var(--ink)]' : 'text-[var(--ink)] hover:bg-slate-50'}`}>
          <span>Unit {unit.unitNumber}</span><span className="shrink-0 text-[10px] text-[var(--muted)]">{unit.floor ? `Floor ${unit.floor}` : ''}</span>
        </button>)}
        {!matches.length && <p className="px-2 py-3 text-xs text-[var(--muted)]">No matching units.</p>}
      </div>
    </div>}
  </div>
}

function UnitWaterHistory({ unit, token, range, metric, onMetricChange }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    apiRequest(`/api/analytics/units/${unit.id}`, { token })
      .then(result => { if (active) setData(result) })
      .catch(error => { if (active) setError(error.message) })
    return () => { active = false }
  }, [unit.id, token, attempt])

  if (error) return <div role="alert" className="rounded-xl border border-red-100 bg-red-50 p-4"><p className="text-sm text-red-700">Could not load Unit {unit.unitNumber}: {error}</p><button type="button" onClick={() => { setError(''); setAttempt(current => current + 1) }} className={retryClass}>Retry unit analytics</button></div>
  if (!data) return <p role="status" className="text-sm text-[var(--muted)]">Loading water history for Unit {unit.unitNumber}...</p>
  const { rows, latestReading, forecast, latestForecast, flaggedCount } = buildUnitWaterAnalytics(data.history, data.forecasts, range)

  const bill = metric === 'bill'
  const latest = bill ? amount(latestReading?.actualWaterBill) : consumption(latestReading?.actualConsumption)
  const estimate = bill ? amount(forecast?.waterBill) : consumption(forecast?.consumption)
  return <section aria-label={`Water analytics for Unit ${unit.unitNumber}`} className="min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="tablist" aria-label="Unit water metric" className="inline-flex rounded-lg bg-[var(--app-bg)] p-1">
        {[['bill', 'Water bill'], ['consumption', 'Consumption']].map(([value, label]) => <button key={value} id={`unit-water-tab-${value}`} role="tab" type="button" aria-selected={metric === value} tabIndex={metric === value ? 0 : -1} aria-controls="unit-water-chart" onClick={() => onMetricChange(value)} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); const next = bill ? 'consumption' : 'bill'; onMetricChange(next); document.getElementById(`unit-water-tab-${next}`)?.focus() } }} className={`min-h-9 rounded-md px-3 text-xs font-semibold transition ${metric === value ? 'bg-white text-[var(--primary)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--ink)]'}`}>{label}</button>)}
      </div>
      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
        <div><dt className="inline text-[var(--muted)]">Latest{latestReading?.label ? ` (${latestReading.label})` : ''}: </dt><dd className="inline font-bold tabular-nums text-[var(--ink)]">{latest}</dd></div>
        <div><dt className="inline text-[var(--muted)]">Estimate{forecast?.label ? ` (${forecast.label})` : ''}: </dt><dd className="inline font-bold tabular-nums text-amber-700">{estimate}</dd></div>
      </dl>
    </div>
    <div id="unit-water-chart" role="tabpanel" aria-labelledby={`unit-water-tab-${metric}`} className="mt-3 min-w-0">
      <WaterChart key={metric} title={bill ? 'Monthly water bill' : 'Monthly water consumption'} unitNumber={unit.unitNumber} rows={rows} actualKey={bill ? 'actualWaterBill' : 'actualConsumption'} estimateKey={bill ? 'estimatedWaterBill' : 'estimatedConsumption'} actualName={bill ? 'Actual water bill' : 'Actual consumption'} estimatedName={bill ? 'Estimated water bill' : 'Estimated consumption'} color={bill ? '#2563eb' : '#059669'} money={bill} />
    </div>
    <div className="mt-2 space-y-1 text-[11px] leading-5 text-[var(--muted)]">
      <p>Consumption in m³ · Bills in PHP · Estimates are not finalized bills.</p>
      {!forecast && <p className="text-amber-800">{latestForecast?.status !== 'READY' && latestForecast?.reason ? latestForecast.reason : 'No next-month estimate is available yet.'}</p>}
      {flaggedCount > 0 && <p className="text-amber-800">{flaggedCount} flagged reading{flaggedCount === 1 ? '' : 's'} excluded. Missing readings appear as gaps.</p>}
    </div>
  </section>
}

function WaterChart({ title, unitNumber, rows, actualKey, estimateKey, actualName, estimatedName, color, money = false }) {
  const hasActual = rows.some(row => row[actualKey] !== null)
  const hasEstimate = rows.some(row => row[estimateKey] !== null)
  return <section aria-label={`${title} for Unit ${unitNumber}`} className="h-52 min-w-0 overflow-hidden sm:h-56">
    {hasActual || hasEstimate ? <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} accessibilityLayer>
        <CartesianGrid strokeDasharray="3 3" stroke="#dceee2" vertical={false} />
        <XAxis dataKey="label" angle={-20} textAnchor="end" height={55} minTickGap={20} tick={{ fontSize: 10 }} />
        <YAxis width={money ? 60 : 45} tick={{ fontSize: 10 }} tickFormatter={value => money ? `₱${Number(value).toLocaleString('en-PH', { notation: 'compact' })}` : Number(value).toLocaleString('en-PH')} />
        <Tooltip formatter={value => money ? currency(value) : consumption(value)} />
        <Legend wrapperStyle={{ fontSize: 11 }} iconSize={9} />
        <Bar dataKey={actualKey} stackId="monthly" name={actualName} fill={color} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
        {hasEstimate && <Bar dataKey={estimateKey} stackId="monthly" name={estimatedName} fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />}
      </BarChart>
    </ResponsiveContainer> : <EmptyRow message="No valid water history is available for this unit yet." />}
  </section>
}
