import { pathToFileURL } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const repository = 'petr1chorL/arc'
const api = `https://api.github.com/repos/${repository}/actions`

export async function requireSuccessfulCI(sha, options = {}) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('Release blocked: full COMMIT_REF required')
  const fetchImpl = options.fetchImpl ?? fetch
  const attempts = options.attempts ?? 21
  const pause = options.sleep ?? sleep
  async function get(url) {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`Release blocked: GitHub API HTTP ${response.status}`)
    return response.json()
  }
  for (let attempt = 0; attempt < attempts; attempt++) {
    const data = await get(`${api}/workflows/ci.yml/runs?head_sha=${sha}&event=push&per_page=100`)
    if (!Array.isArray(data.workflow_runs)) throw new Error('Release blocked: invalid CI response')
    const run = data.workflow_runs.filter((item) => item.head_sha === sha && item.event === 'push'
      && item.path === '.github/workflows/ci.yml' && item.head_repository?.full_name === repository)
      .sort((a, b) => b.id - a.id)[0]
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const runId = await requireSuccessfulCI(process.env.COMMIT_REF)
    console.log(`Release gate passed: CI run ${runId}, commit ${process.env.COMMIT_REF}`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
