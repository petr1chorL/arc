import { describe, expect, it } from 'vitest'
import cases from '../fixtures/reference-assets-policy.json'
import {
  AssetConfigurationError,
  validateAdapterConfig,
} from '../netlify/functions/_shared/reference-assets/policy.ts'

describe('reference asset shared configuration contract', () => {
  for (const entry of cases) {
    it(entry.name, () => {
      const original = structuredClone(entry.config)
      if (entry.valid) {
        expect(() => validateAdapterConfig(entry.type, entry.config)).not.toThrow()
      } else {
        expect(() => validateAdapterConfig(entry.type, entry.config)).toThrow(AssetConfigurationError)
        expect(() => validateAdapterConfig(entry.type, entry.config)).toThrow('资产配置包含不支持或不安全的字段')
      }
      expect(entry.config).toEqual(original)
    })
  }
})
