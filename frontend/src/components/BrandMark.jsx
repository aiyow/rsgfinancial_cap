const sizes = {
  sm: 'size-9',
  md: 'size-10',
  lg: 'size-11',
}

export default function BrandMark({ size = 'md' }) {
  return <img src="/residens-portal-logo.png" alt="" aria-hidden="true" className={`shrink-0 rounded-xl object-cover shadow-sm ${sizes[size] || sizes.md}`} />
}
