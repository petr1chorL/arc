import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Netlify deployment policy', () => {
  it('builds the Vite SPA and proxies API traffic before the SPA fallback', () => {
    expect(existsSync('netlify.toml')).toBe(true)

    const config = readFileSync('netlify.toml', 'utf8')
    const apiProxy = config.indexOf('from = "/api/*"')
    const spaFallback = config.indexOf('from = "/*"')

    expect(config).toContain('command = "node scripts/verify-ci-release.mjs && npm run build"')
    expect(config).toContain('publish = "dist"')
    expect(apiProxy).toBeGreaterThan(-1)
    expect(config).toContain('to = "https://arc-v1-lite-lindabaoz.zeabur.app/api/:splat"')
    expect(spaFallback).toBeGreaterThan(apiProxy)
    expect(config).toContain('to = "/index.html"')
  })
})
