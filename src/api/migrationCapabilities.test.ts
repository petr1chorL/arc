import { afterEach, expect, test, vi } from 'vitest'
import { isReferenceAssetMigration, isToolTestAvailable } from './migrationCapabilities'

afterEach(() => vi.unstubAllEnvs())

test('Tool execution is separate from Provider and asset-registration migration capabilities', () => {
  for (const mode of ['reference-assets', 'agents', 'data-objects', 'rubric-samples', 'workflows']) {
    vi.stubEnv('VITE_ARC_ONE_MIGRATION_MODE', mode)
    expect(isToolTestAvailable()).toBe(false)
    expect(isReferenceAssetMigration()).toBe(true)
  }
  vi.stubEnv('VITE_ARC_ONE_MIGRATION_MODE', 'runtime')
  expect(isToolTestAvailable()).toBe(true)
  expect(isReferenceAssetMigration()).toBe(true)
  vi.stubEnv('VITE_ARC_ONE_MIGRATION_MODE', '')
  expect(isToolTestAvailable()).toBe(true)
})
