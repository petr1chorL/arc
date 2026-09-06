import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e', testMatch: ['reference-assets.spec.ts', 'agent-lifecycle.spec.ts', 'data-object-lifecycle.spec.ts', 'rubric-governance.spec.ts', 'feedback-governance.spec.ts', 'workflow-governance.spec.ts'], workers: 1,
  globalTeardown: './e2e/reference-assets-teardown.ts',
  reporter: 'line', timeout: 60_000,
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:48273', trace: 'retain-on-failure' },
  webServer: [
    { command: `node --experimental-transform-types scripts/reference-assets-e2e-server.mjs ${process.env.ARC_ONE_TEST_PG_PORT ?? '5432'}`,
      url: 'http://127.0.0.1:48200/__ready', reuseExistingServer: false, timeout: 30_000 },
    { command: 'node node_modules/vite/bin/vite.js --config vite.reference-assets.config.ts',
      url: 'http://127.0.0.1:48273', reuseExistingServer: false, timeout: 30_000 },
  ],
})
