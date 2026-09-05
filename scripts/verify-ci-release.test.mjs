import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { requireSuccessfulCI } from './verify-ci-release.mjs'

const sha = 'a'.repeat(40)
const good = { id: 1, head_sha: sha, event: 'push', path: '.github/workflows/ci.yml',
  head_repository: { full_name: 'petr1chorL/arc' }, status: 'completed', conclusion: 'success' }
const jobs = { jobs: [{ name: 'verify', status: 'completed', conclusion: 'success' }] }
const response = (data) => ({ ok: true, json: async () => data })
const check = (runs, overrides = {}) => requireSuccessfulCI(sha, {
  attempts: 1, fetchImpl: async (url) => response(url.includes('/jobs') ? jobs : { workflow_runs: runs }),
  ...overrides,
})

describe('exact revision release gate', () => {
  it('accepts successful push CI and verify job for the exact revision', async () => {
    await expect(check([good])).resolves.toBe(1)
  })
  it.each([
    { head_sha: 'b'.repeat(40) }, { event: 'pull_request' }, { path: '.github/workflows/other.yml' },
    { head_repository: { full_name: 'someone/arc' } }, { conclusion: 'failure' },
    { conclusion: 'cancelled' }, { conclusion: 'skipped' }, { status: 'in_progress' },
  ])('fails closed for mismatched or unsuccessful run %j', async (patch) => {
    await expect(check([{ ...good, ...patch }])).rejects.toThrow()
  })
  it('does not accept an older success over a newer failed run', async () => {
    await expect(check([good, { ...good, id: 2, conclusion: 'failure' }])).rejects.toThrow()
  })
  it('rejects missing runs, missing SHA, API errors and skipped verify job', async () => {
    await expect(check([])).rejects.toThrow()
    await expect(requireSuccessfulCI('')).rejects.toThrow()
    await expect(check([], { fetchImpl: async () => ({ ok: false, status: 403 }) })).rejects.toThrow()
    await expect(check([good], { fetchImpl: async (url) => response(url.includes('/jobs')
      ? { jobs: [{ name: 'verify', status: 'completed', conclusion: 'skipped' }] }
      : { workflow_runs: [good] }) })).rejects.toThrow()
  })
  it('waits for a running exact revision and then permits its success', async () => {
    let requests = 0
    await expect(check([], { attempts: 2, sleep: async () => {}, fetchImpl: async (url) => {
      if (url.includes('/jobs')) return response(jobs)
      requests++
      return response({ workflow_runs: [{ ...good, status: requests === 1 ? 'in_progress' : 'completed' }] })
    } })).resolves.toBe(1)
  })
  it('wires the gate to every Netlify build and covers migration branch pushes', () => {
    const config = readFileSync('netlify.toml', 'utf8')
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8')
    expect(config).toContain('node scripts/verify-ci-release.mjs && npm run build')
    expect(ci).toContain('"codex/**"')
    expect(ci).toContain('codex/harness-governance')
    expect(ci).toContain('node --experimental-transform-types scripts/test-identity-postgres.mjs')
  })
})
