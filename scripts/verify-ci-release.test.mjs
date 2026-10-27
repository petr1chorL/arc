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
  it('authenticates both fixed GitHub requests without following redirects', async () => {
    const calls = []
    await expect(check([good], { token: 'TEST_ONLY_READ_TOKEN', fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return response(url.includes('/jobs') ? jobs : { workflow_runs: [good] })
    } })).resolves.toBe(1)
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(new URL(call.url).origin).toBe('https://api.github.com')
      expect(call.init.headers.Authorization).toBe('Bearer TEST_ONLY_READ_TOKEN')
      expect(call.init.redirect).toBe('error')
    }
  })

  it('waits for the later rate-limit boundary before retrying the same CI request', async () => {
    let calls = 0
    const waits = []
    await expect(check([good], { now: () => 100_000, sleep: async ms => waits.push(ms), fetchImpl: async url => {
      calls++
      if (calls === 1) return new Response(null, { status: 403,
        headers: { 'retry-after': '2', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '105' } })
      return response(url.includes('/jobs') ? jobs : { workflow_runs: [good] })
    } })).resolves.toBe(1)
    expect(waits).toEqual([6000])
    expect(calls).toBe(3)
  })

  it('recovers bounded transport and upstream failures without accepting a different CI result', async () => {
    let calls = 0
    const waits = []
    await expect(check([good], { sleep: async ms => waits.push(ms), fetchImpl: async url => {
      calls++
      if (calls === 1) throw Error('TEST_ONLY_PRIVATE_TRANSPORT_DETAILS')
      if (calls === 2) return new Response(null, { status: 502 })
      return response(url.includes('/jobs') ? jobs : { workflow_runs: [good] })
    } })).resolves.toBe(1)
    expect(calls).toBe(4)
    expect(waits).toEqual([1000, 2000])
  })

  it('shares the two-retry budget between the run and jobs requests', async () => {
    let calls = 0
    const waits = []
    await expect(check([good], { sleep: async ms => waits.push(ms), fetchImpl: async () => {
      calls++
      return calls === 2 ? response({ workflow_runs: [good] }) : new Response(null, { status: 503 })
    } })).rejects.toThrow('retry budget exhausted')
    expect(calls).toBe(4)
    expect(waits).toEqual([1000, 2000])
  })

  it('never exposes transport or JSON parsing error details', async () => {
    await expect(check([], { sleep: async () => {}, fetchImpl: async () => {
      throw Error('TEST_ONLY_PRIVATE_TRANSPORT_DETAILS')
    } })).rejects.toMatchObject({ message: 'Release blocked: GitHub API request failed (retry budget exhausted)' })
    await expect(check([], { fetchImpl: async () => ({ ok: true,
      json: async () => { throw Error('TEST_ONLY_PRIVATE_PARSE_DETAILS') },
    }) })).rejects.toMatchObject({ message: 'Release blocked: invalid GitHub API response' })
  })

  it.each([401, 403, 404])('does not retry authentication or ordinary access errors (%s)', async status => {
    let calls = 0
    await expect(check([], { token: 'TEST_ONLY_READ_TOKEN', sleep: async () => { throw Error('must not retry') },
      fetchImpl: async () => { calls++; return new Response(null, { status }) },
    })).rejects.toThrow(`GitHub API HTTP ${status}`)
    expect(calls).toBe(1)
  })

  it.each([
    { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '200' },
    { 'x-ratelimit-remaining': '0' },
    { 'retry-after': '120' },
    { 'retry-after': 'invalid' },
  ])('never shortens an unavailable or over-budget rate-limit wait %j', async headers => {
    let calls = 0
    const waits = []
    await expect(check([], { now: () => 100_000, sleep: async ms => waits.push(ms),
      fetchImpl: async () => { calls++; return new Response(null, { status: 403, headers }) },
    })).rejects.toThrow('upstream retry wait unavailable or exceeds 60s budget')
    expect(calls).toBe(1)
    expect(waits).toEqual([])
  })

  it('waits a full minute for a headerless429 and then fails closed if it persists', async () => {
    let calls = 0
    const waits = []
    await expect(check([], { sleep: async ms => waits.push(ms),
      fetchImpl: async () => { calls++; return new Response(null, { status: 429 }) },
    })).rejects.toThrow('exceeds 60s budget')
    expect(calls).toBe(2)
    expect(waits).toEqual([60_000])
  })

  it('honors a long Retry-After on503 without retrying early', async () => {
    let calls = 0
    await expect(check([], { sleep: async () => { throw Error('must not retry early') },
      fetchImpl: async () => { calls++; return new Response(null, { status: 503, headers: { 'retry-after': '120' } }) },
    })).rejects.toThrow('exceeds 60s budget')
    expect(calls).toBe(1)
  })

  it.each(['', 'bad token', 'bad\r\nheader', '非ASCII', 'x'.repeat(4097), 123])('rejects invalid token configuration before fetching (%#)', async token => {
    let calls = 0
    await expect(check([], { token, fetchImpl: async () => { calls++; return response({}) } }))
      .rejects.toThrow('invalid CI read-token configuration')
    expect(calls).toBe(0)
  })

  it.each([{ conclusion: 'failure' }, { head_sha: 'b'.repeat(40) }])('still rejects bad CI after rate-limit recovery %j', async patch => {
    let calls = 0
    await expect(check([], { sleep: async () => {}, fetchImpl: async () => {
      calls++
      return calls === 1 ? new Response(null, { status: 403, headers: { 'retry-after': '1' } })
        : response({ workflow_runs: [{ ...good, ...patch }] })
    } })).rejects.toThrow()
    expect(calls).toBe(2)
  })

  it.each([undefined, 0, '../other-repo', '1'])('rejects malformed run IDs before constructing the jobs URL (%#)', async id => {
    let calls = 0
    await expect(check([], { token: 'TEST_ONLY_READ_TOKEN', fetchImpl: async url => {
      calls++
      return response(url.includes('/jobs') ? jobs : { workflow_runs: [{ ...good, id }] })
    } })).rejects.toThrow('invalid CI run ID')
    expect(calls).toBe(1)
  })
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
