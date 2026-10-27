import type { SqlPool } from '../identity-workspace/postgres.ts'
import { NotSentError } from '../runtime/types.ts'

export const ACCEPTANCE_PROFILE = 'qwen-flash-1cny'
export const ACCEPTANCE_BUDGET_ID = 'qwen-flash-1cny-20261027'
export const ACCEPTANCE_BINDING = Object.freeze({ workspaceId: 'arc-one', host: 'maas.qianwenaiapi.com', secretRef: 'ARC_QWEN_API_KEY' })
const endpoint = 'https://maas.qianwenaiapi.com/compatible-mode/v1/chat/completions'
export type AcceptancePoolLoader = () => SqlPool | Promise<SqlPool>
const rejected = () => new NotSentError('验收请求超出已授权范围，未发送')

/** An autocommitted conditional upsert reserves globally; no refund or deployment reset exists. */
export async function reserveAcceptanceCall(loadPool: AcceptancePoolLoader): Promise<void> {
  try {
    const client = await (await loadPool()).connect()
    try {
      const result = await client.query(`INSERT INTO native_acceptance_budget (id,reserved_calls) VALUES ($1,1)
        ON CONFLICT (id) DO UPDATE SET reserved_calls=native_acceptance_budget.reserved_calls+1
        WHERE native_acceptance_budget.reserved_calls<20 RETURNING reserved_calls`, [ACCEPTANCE_BUDGET_ID])
      if (result.rows.length !== 1) throw new Error('Budget exhausted')
    } finally { client.release() }
  } catch { throw new NotSentError('验收预算不可用或已用尽，未发送') }
}

function boundedBody(value: unknown): string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 8192) throw rejected()
  let body: Record<string, unknown>
  try { body = JSON.parse(value) } catch { throw rejected() }
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !['model', 'messages', 'temperature', 'max_tokens'].includes(key))
    || body.model !== 'qwen3.8-flash' || !Number.isInteger(body.max_tokens) || Number(body.max_tokens) < 1
    || typeof body.temperature !== 'number' || !Number.isFinite(body.temperature) || body.temperature < 0 || body.temperature > 2
    || !Array.isArray(body.messages) || body.messages.length !== 2) throw rejected()
  for (const [index, message] of body.messages.entries()) {
    if (!message || typeof message !== 'object' || Array.isArray(message)
      || Object.keys(message).some(key => !['role', 'content'].includes(key))
      || message.role !== (index ? 'user' : 'system') || typeof message.content !== 'string') throw rejected()
  }
  const bounded = JSON.stringify({ model: body.model, messages: body.messages, temperature: body.temperature,
    max_completion_tokens: Math.min(Number(body.max_tokens), 512), enable_thinking: false, stream: false })
  if (Buffer.byteLength(bounded, 'utf8') > 8192) throw rejected()
  return bounded
}

/** Narrow transport shared by all model executions under the opt-in acceptance profile. */
export function createAcceptanceFetch(loadPool: AcceptancePoolLoader | undefined, transport: typeof fetch = fetch): typeof fetch {
  return async (url, init) => {
    if (url !== endpoint || init?.method !== 'POST' || init.redirect !== 'error' || !loadPool) throw rejected()
    const body = boundedBody(init.body)
    if (init.signal?.aborted) throw new NotSentError('验收请求已取消，未发送')
    await reserveAcceptanceCall(loadPool)
    // Reservation remains consumed if cancellation, transport or response fails.
    if (init.signal?.aborted) throw new NotSentError('验收请求已取消，未发送')
    return transport(endpoint, { ...init, body })
  }
}
