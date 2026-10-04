// Focus the section, not an input: scrolling must not open the mobile keyboard.
export function scrollToLogin(section, reducedMotion = false) {
  if (!section) return false
  section.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
  section.focus({ preventScroll: true })
  return true
}
