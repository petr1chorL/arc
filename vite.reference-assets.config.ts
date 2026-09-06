import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Isolated local verification: no Netlify plugin, environment files or external proxy.
export default defineConfig({
  plugins: [react(), {
    name: 'isolated-system-fonts', enforce: 'pre',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url !== '/__shutdown' || request.method !== 'POST'
          || request.headers['x-arc-synthetic-shutdown'] !== '1' || request.headers.origin) return next()
        response.end('stopping')
        setImmediate(() => { void server.close().then(() => process.exit(0)) })
      })
    },
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/index.css')) return
      return code.replace(/^@import url\('https:\/\/fonts\.googleapis\.com\/[^']+'\);\r?\n/, '')
    },
  }], envDir: false,
  define: { 'import.meta.env.VITE_ARC_ONE_MIGRATION_MODE': JSON.stringify('workflows') },
  server: { host: '127.0.0.1', port: 48273, strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:48200' } },
})
