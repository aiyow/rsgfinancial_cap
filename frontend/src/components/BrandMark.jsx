import { Building2, Droplets } from 'lucide-react'

const sizes = {
  sm: 'size-9',
  md: 'size-10',
  lg: 'size-11',
}

export default function BrandMark({ size = 'md' }) {
  return (
    <span className={`relative grid shrink-0 place-items-center rounded-xl bg-[var(--primary)] text-white shadow-sm ${sizes[size] || sizes.md}`} aria-hidden="true">
      <Droplets size={size === 'lg' ? 25 : 22} strokeWidth={2.2} className="-translate-y-0.5" />
      <span className="absolute bottom-1 right-1 grid size-3.5 place-items-center rounded-sm border border-white/70 bg-[var(--ink)] text-white">
        <Building2 size={9} strokeWidth={2.5} />
      </span>
    </span>
  )
}
