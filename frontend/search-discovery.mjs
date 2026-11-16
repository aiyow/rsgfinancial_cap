export const DEFAULT_SITE_URL = 'https://residens-condo.onrender.com'
export const SEARCH_TITLE = 'The ResiDens Condominium | Resident Portal'
export const SEARCH_DESCRIPTION = 'The ResiDens condominium resident portal. Sign in to view Statements of Account, manage payments, and track water consumption.'

export function publicSiteOrigin(value = DEFAULT_SITE_URL) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || !['/', '/login', '/login/'].includes(url.pathname)) {
    throw new Error('VITE_SITE_URL must be your public HTTPS frontend address, optionally ending in /login.')
  }
  return url.origin
}

export function searchFiles(siteUrl = DEFAULT_SITE_URL) {
  const origin = publicSiteOrigin(siteUrl)
  return {
    robots: `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`,
    sitemap: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${origin}/login</loc></url>\n</urlset>\n`,
  }
}

export function searchDiscovery({ siteUrl = DEFAULT_SITE_URL, verification = '' } = {}) {
  const origin = publicSiteOrigin(siteUrl)
  const files = searchFiles(origin)
  return {
    name: 'residens-search-discovery',
    transformIndexHtml() {
      return [
        { tag: 'link', attrs: { rel: 'canonical', href: `${origin}/login` }, injectTo: 'head' },
        ...Object.entries({ 'og:type': 'website', 'og:site_name': 'The ResiDens', 'og:title': SEARCH_TITLE,
          'og:description': SEARCH_DESCRIPTION, 'og:url': `${origin}/login`, 'og:image': `${origin}/icons/pwa-512.png` })
          .map(([property, content]) => ({ tag: 'meta', attrs: { property, content }, injectTo: 'head' })),
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary' }, injectTo: 'head' },
        ...(verification.trim() ? [{ tag: 'meta', attrs: { name: 'google-site-verification', content: verification.trim() }, injectTo: 'head' }] : []),
      ]
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: files.robots })
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: files.sitemap })
    },
  }
}
