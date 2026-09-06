import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Synthetic runtime only: no environment files, Netlify plugin or external requests.
export default defineConfig({
  envDir: false,
  plugins: [react(), {
    name: 'runtime-system-fonts', enforce: 'pre',
    configureServer(server) {
      server.middlewares.use((request,response,next) => {
        if (request.url !== '/__shutdown' || request.method !== 'POST' || request.headers['x-arc-synthetic-control'] !== 'TEST_ONLY' || request.headers.origin) return next()
        response.end('stopping')
        setImmediate(() => { void server.close().then(() => process.exit(0)) })
      })
    },
    transform(code, id) {
      if (id.replaceAll('\\', '/').endsWith('/src/index.css')) return code.replace(/^@import url\('https:\/\/fonts\.googleapis\.com\/[^']+'\);\r?\n/, '')
    },
  }],
  define: { 'import.meta.env.VITE_ARC_ONE_MIGRATION_MODE': JSON.stringify('runtime') },
  server: { host: '127.0.0.1', port: 5175, strictPort: true, proxy: { '/api': 'http://127.0.0.1:48275' } },
})
