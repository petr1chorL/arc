const RECOVERABLE_RUN_STATUSES = new Set(['等待审核', '审核中'])
const TERMINAL_RUN_STATUSES = new Set(['已完成', '已失败', '失败', '恢复失败', '已取消', '已驳回'])

export class AcceptanceApiError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'AcceptanceApiError'
    this.status = status
  }
}

function detailMessage(value) {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''
  return typeof value.msg === 'string' ? value.msg.trim() : ''
}

function formatErrorDetail(detail) {
  const values = Array.isArray(detail) ? detail : [detail]
  const messages = values.map(detailMessage).filter(Boolean)
  return messages.length > 0 ? messages.join('; ') : 'request failed'
}

export async function readAcceptanceResponse(response, { method, path }) {
  const text = await response.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      const contentType = (response.headers.get('content-type') ?? 'unknown')
        .split(';', 1)[0]
        .trim()
      throw new AcceptanceApiError(
        response.status,
        `${method} ${path} failed with HTTP ${response.status}: expected JSON but received ${contentType}`,
      )
    }
  }
  if (!response.ok) {
    throw new AcceptanceApiError(
      response.status,
      `${method} ${path} failed with HTTP ${response.status}: ${formatErrorDetail(data?.detail)}`,
    )
  }
  return data
}

export function findLatestRecoverableRun(runs, {
  workflowId,
  input,
  now = Date.now(),
  maxAgeMs = 6 * 60 * 60 * 1000,
}) {
  if (!Array.isArray(runs)) return null
  const candidates = runs.filter((run) => {
    const startedAt = Date.parse(run.startedAt)
    const ageMs = now - startedAt
    return run.workflowId === workflowId
      && run.input === input
      && RECOVERABLE_RUN_STATUSES.has(run.status)
      && Number.isFinite(startedAt)
      && ageMs >= 0
      && ageMs <= maxAgeMs
  })
  candidates.sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
  return candidates[0] ?? null
}

export function formatRunFailure(run) {
  const details = []
  if (run?.error) details.push(run.error)
  for (const node of run?.nodes ?? []) {
    if (!node?.error) continue
    details.push(`${node.nodeName || node.nodeId || 'unknown node'}: ${node.error}`)
  }
  return [...new Set(details)].join('; ') || `status: ${run?.status ?? 'unknown'}`
}

export async function waitForRunCompletion(loadRun, {
  maxAttempts = 121,
  retryDelayMs = 2000,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
} = {}) {
  let latestRun = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    latestRun = await loadRun()
    if (TERMINAL_RUN_STATUSES.has(latestRun?.status)) return latestRun
    if (attempt < maxAttempts) await sleep(retryDelayMs)
  }
  throw new Error(
    `Workflow Run did not reach a terminal status after ${maxAttempts} checks; latest status: ${latestRun?.status ?? 'unknown'}`,
  )
}