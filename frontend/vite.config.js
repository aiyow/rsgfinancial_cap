import { defineConfig, loadEnv } from 'vite'
import { DEFAULT_SITE_URL, searchDiscovery } from './search-discovery.mjs'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cwd } from 'node:process'

function offlineShell() {
  let output
  return {
    name: 'resident-offline-shell',
    apply: 'build',
    configResolved(config) { output = config.build.outDir },
    async closeBundle() {
      const assets = (await readdir(join(output, 'assets'))).filter(name => /\.(js|css|woff2?)$/.test(name))
      const html = await readFile(join(output, 'index.html'), 'utf8')
      const version = createHash('sha256').update(html + assets.join(',')).digest('hex').slice(0, 16)
      const files = ['/index.html', '/residens-portal-logo.png', '/residens-logo.png', '/favicon.svg',
        ...assets.map(name => '/assets/' + name)]
      const worker = await readFile(join(output, 'push-worker.js'), 'utf8')
      await writeFile(join(output, 'push-worker.js'), worker
        .replace('/* OFFLINE_FILES */ []', JSON.stringify(files))
        .replace('OFFLINE_BUILD_VERSION', version))
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, cwd(), 'VITE_')
  return { plugins: [react(), tailwindcss(), searchDiscovery({
    siteUrl: environment.VITE_SITE_URL || DEFAULT_SITE_URL,
    verification: environment.VITE_GOOGLE_SITE_VERIFICATION || '',
  }), offlineShell()] }
})
