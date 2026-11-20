import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// Serves MSW's service worker in dev only, straight from node_modules. It's deliberately not in public/: Vite copies
// public/ into every build, and the worker must never ship to production. This also keeps the worker's version in
// step with the installed msw.
function mswWorkerDevOnly(): Plugin {
  return {
    name: 'msw-worker-dev-only',
    apply: 'serve',
    configureServer(server) {
      const file = createRequire(import.meta.url).resolve('msw/mockServiceWorker.js')
      server.middlewares.use('/mockServiceWorker.js', (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript')
        res.end(readFileSync(file))
      })
    },
  }
}

// The app is dynamically imported by the tiny boot entry (src/boot/boot.ts), so the lock screen can run first.
// Without help, the browser would only discover the app chunk after boot.ts executes. This adds modulepreload links
// for the app chunk and its static imports, so they download in parallel with boot.ts.
function preloadAppChunk(): Plugin {
  return {
    name: 'preload-app-chunk',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const chunks = Object.values(ctx.bundle ?? {}).filter((c) => c.type === 'chunk')
        const app = chunks.find((c) => c.facadeModuleId?.replaceAll('\\', '/').endsWith('/src/main.tsx'))
        if (!app) throw new Error('preload-app-chunk: app chunk (src/main.tsx) not found')
        // Skip entry chunks: index.html already loads boot.ts with a <script>.
        const entries = new Set(chunks.filter((c) => c.isEntry).map((c) => c.fileName))
        return [app.fileName, ...app.imports.filter((f) => !entries.has(f))].map((file) => ({
          tag: 'link',
          attrs: { rel: 'modulepreload', crossorigin: true, href: `/${file}` },
          injectTo: 'head' as const,
        }))
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), mswWorkerDevOnly(), preloadAppChunk()],
  server: {
    // Same origin as production, where Caddy routes /api to the API (SRS §6.2), so the refresh
    // cookie works in dev. ws: true carries Socket.io, which runs on /api/socket.io (namespace /ws).
    proxy: {
      '/api': { target: 'http://localhost:4000', ws: true },
    },
  },
})
