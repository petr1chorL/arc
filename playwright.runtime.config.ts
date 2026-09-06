import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e', testMatch: 'runtime-closure.spec.ts', workers: 1, reporter: 'line', timeout: 60000,
  globalTeardown: './e2e/runtime-teardown.ts',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5175', trace: 'retain-on-failure' },
  webServer: [
    { command: 'node --experimental-transform-types scripts/runtime-e2e-server.mjs', url: 'http://127.0.0.1:48275/__ready', reuseExistingServer: false, timeout: 30000 },
    { command: 'node node_modules/vite/bin/vite.js --config vite.runtime.config.ts', url: 'http://127.0.0.1:5175', reuseExistingServer: false, timeout: 30000 },
  ],
})
