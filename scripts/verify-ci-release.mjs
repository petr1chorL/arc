import { pathToFileURL } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const repository = 'petr1chorL/arc'
const api = `https://api.github.com/repos/${repository}/actions`

export async function requireSuccessfulCI(sha, options = {}) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('Release blocked: full COMMIT_REF required')
  const fetchImpl = options.fetchImpl ?? fetch
  const attempts = options.attempts ?? 21
  const pause = options.sleep ?? sleep
  const token = options.token
  if (token !== undefined && (typeof token !== 'string' || token.length > 4096 || !/^[\x21-\x7e]+$/.test(token))) {
    throw new Error('Release blocked: invalid CI read-token configuration')
  }
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'arc-one-release-gate', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  let retriesLeft = 2
  async function get(url) {
    for (;;) {
      let response
      try {
        response = await fetchImpl(url, {
          headers, redirect: 'error', signal: AbortSignal.timeout(15_000),
        })
      } catch {
        if (retriesLeft === 0) throw new Error('Release blocked: GitHub API request failed (retry budget exhausted)')
        const delay = 1000 * 2 ** (2 - retriesLeft)
        retriesLeft--
        await pause(delay)
        continue
      }
      if (response.ok) {
        try { return await response.json() }
        catch { throw new Error('Release blocked: invalid GitHub API response') }
      }
      const rateWait = rateLimitWait(response, (options.now ?? Date.now)(), 2 - retriesLeft)
      try { await response.body?.cancel() } catch { /* Never expose upstream response content. */ }
      const delay = rateWait ?? ([502, 503, 504].includes(response.status)
        ? Math.max(1000 * 2 ** (2 - retriesLeft), retryAfterMs(response) ?? 0) : null)
      if (delay === null) throw new Error(`Release blocked: GitHub API HTTP ${response.status}`)
      if (!Number.isFinite(delay) || delay > 60_000) {
        throw new Error(`Release blocked: GitHub API HTTP ${response.status} (upstream retry wait unavailable or exceeds 60s budget)`)
      }
      if (retriesLeft === 0) throw new Error(`Release blocked: GitHub API HTTP ${response.status} (retry budget exhausted)`)
      retriesLeft--
      await pause(delay)
    }
  }
  for (let attempt = 0; attempt < attempts; attempt++) {
    const data = await get(`${api}/workflows/ci.yml/runs?head_sha=${sha}&event=push&per_page=100`)
    if (!Array.isArray(data.workflow_runs)) throw new Error('Release blocked: invalid CI response')
    const matching = data.workflow_runs.filter((item) => item?.head_sha === sha && item.event === 'push'
      && item.path === '.github/workflows/ci.yml' && item.head_repository?.full_name === repository)
    if (matching.some(run => !Number.isSafeInteger(run.id) || run.id < 1)) {
      throw new Error('Release blocked: invalid CI run ID')
    }
    const run = matching.sort((a, b) => b.id - a.id)[0]
    if (run?.status === 'completed') {
      if (run.conclusion !== 'success') throw new Error(`Release blocked: CI ${run.conclusion}`)
      const result = await get(`${api}/runs/${run.id}/jobs?filter=latest&per_page=100`)
      if (!result.jobs?.some((job) => job.name === 'verify'
        && job.status === 'completed' && job.conclusion === 'success')) {
        throw new Error('Release blocked: verify job did not succeed')
      }
      return run.id
    }
    if (attempt + 1 < attempts) await pause(60_000)
  }
  throw new Error('Release blocked: exact revision CI missing or timed out')
}

/** Never retry before either upstream boundary, or guess a missing primary reset time. */
function rateLimitWait(response, now, retryIndex) {
  const header = name => response.headers?.get?.(name)
  const after = header('retry-after'), remaining = header('x-ratelimit-remaining')
  if (response.status !== 429 && !(response.status === 403 && (after != null || remaining === '0'))) return null
  const afterMs = retryAfterMs(response)
  let wait = afterMs ?? 60_000 * 2 ** retryIndex
  if (remaining === '0') {
    const reset = header('x-ratelimit-reset')
    if (typeof reset !== 'string' || !/^\d+$/.test(reset)) return Infinity
    const resetWait = Math.max(1000, Number(reset) * 1000 - now + 1000)
    wait = afterMs !== undefined ? Math.max(wait, resetWait) : resetWait
  }
  return wait
}

function retryAfterMs(response) {
  const value = response.headers?.get?.('retry-after')
  if (value == null) return undefined
  return /^\d+$/.test(value) ? Math.max(1000, Number(value) * 1000) : Infinity
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const runId = await requireSuccessfulCI(process.env.COMMIT_REF, { token: process.env.NETLIFY_CI_READ_TOKEN })
    console.log(`Release gate passed: CI run ${runId}, commit ${process.env.COMMIT_REF}`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
