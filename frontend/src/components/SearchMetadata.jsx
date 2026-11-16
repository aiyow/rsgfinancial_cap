import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

export default function SearchMetadata() {
  const { pathname } = useLocation()
  useEffect(() => {
    const robots = document.querySelector('meta[name="robots"]')
    if (robots) robots.content = ['/', '/login', '/login/'].includes(pathname) ? 'index, follow' : 'noindex, nofollow'
  }, [pathname])
  return null
}
