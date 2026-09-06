import react from '@vitejs/plugin-react'
import netlify from '@netlify/vite-plugin'
import { defineConfig, configDefaults } from 'vitest/config'

const apiProxyTarget = process.env.ARC_ONE_API_PROXY_TARGET ?? 'http://127.0.0.1:8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), netlify()],
  server: {
    proxy: {
      '/api': apiProxyTarget,
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
    // Native runtime checks use node:test and real isolated PG, registered separately in CI.
    exclude: [
      ...configDefaults.exclude, 'scripts/runtime-*.test.mjs',
      'scripts/native-deployment.test.mjs', 'scripts/native-runtime-config.test.mjs',
      'scripts/provider-compat.test.mjs', 'scripts/cutover-source-inventory.test.mjs',
    ],
    setupFiles: './src/test/setup.ts',
  },
})
