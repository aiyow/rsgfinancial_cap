export default function UnitSoaNameCell({ row, editing, name, saving, onChange }) {
  if (!editing) return <span className="break-words">{row.soaResidentName || '—'}</span>

  return <div className="min-w-48 max-w-md">
    <label className="sr-only" htmlFor={`soa-name-${row.unitId}`}>Resident name for unit {row.unitNumber}</label>
    <input id={`soa-name-${row.unitId}`} maxLength={205} value={name} disabled={saving}
      onChange={event => onChange(event.target.value)}
      className="w-full rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-emerald-200" />
  </div>
}
