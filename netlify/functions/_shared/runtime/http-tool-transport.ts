import { isIP } from 'node:net'
import { validateAdapterConfig } from '../reference-assets/policy.ts'
import { NotSentError } from './types.ts'

export type HttpToolOptions = { allowedBindings: readonly { workspaceId: string; host: string }[];
  fetch?: typeof fetch; requestTimeoutMs?: number }
export type HttpToolResult = { status: 'succeeded' | 'failed'; outputSummary: string; error: string;
  durationMs: number; errorCode?: string }

/** Syntax is not authorization: every send also requires an explicit Workspace/host binding. */
export function validateHttpToolTarget(config: Record<string, unknown>, workspaceId: string, options: HttpToolOptions) {
  try { validateAdapterConfig('http', config) } catch { throw new NotSentError('HTTP Tool 地址未获准，未执行') }
  const url = new URL(String(config.url))
  if (isIP(url.hostname) || url.hostname.startsWith('[') || !options.allowedBindings.some(
    binding => binding.workspaceId === workspaceId && binding.host.toLowerCase() === url.hostname.toLowerCase())) {
    throw new NotSentError('HTTP Tool 地址未获准，未执行')
  }
}

/** Matches common httpx QueryParams values; JSON numbers use their normalized numeric representation. */
export function toolQueryParameters(parameters: Record<string, unknown>): URLSearchParams {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(parameters)) {
    for (const item of Array.isArray(value) ? value : [value]) query.append(key,
      item === null ? '' : typeof item === 'object' ? pythonRepr(item) : String(item))
  }
  return query
}

function pythonRepr(value: unknown): string {
  if (value === null) return 'None'
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (typeof value === 'string') {
    const quote = value.includes("'") && !value.includes('"') ? '"' : "'"
    const content = Array.from(value).map(char => {
      if (char === '\\' || char === quote) return `\\${char}`
      if (char === '\n') return '\\n'
      if (char === '\r') return '\\r'
      if (char === '\t') return '\\t'
      if (char !== ' ' && /[\p{C}\p{Z}]/u.test(char)) {
        const point = char.codePointAt(0)!
        return `\\${point <= 255 ? 'x' : point <= 65535 ? 'u' : 'U'}${point.toString(16).padStart(point <= 255 ? 2 : point <= 65535 ? 4 : 8, '0')}`
      }
      return char
    }).join('')
    return `${quote}${content}${quote}`
  }
  if (Array.isArray(value)) return `[${value.map(pythonRepr).join(', ')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).map(([key, item]) => `${pythonRepr(key)}: ${pythonRepr(item)}`).join(', ')}}`
  return String(value)
}

/** A single bounded attempt. Transport ambiguity is thrown, never turned into a retryable not-sent result. */
export async function invokeHttpTool(config: Record<string, unknown>, parameters: Record<string, unknown>,
  workspaceId: string, invocationId: string, options: HttpToolOptions): Promise<HttpToolResult> {
  validateHttpToolTarget(config, workspaceId, options)
  const milliseconds = options.requestTimeoutMs ?? 10000
  if (!Number.isInteger(milliseconds) || milliseconds < 1 || milliseconds > 10000) throw new NotSentError('HTTP Tool 时限无效')
  const started = Date.now(), url = new URL(String(config.url)), method = String(config.method ?? 'POST')
  if (method === 'GET') url.search = toolQueryParameters(parameters).toString()
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      (async () => {
        const response = await (options.fetch ?? fetch)(url.toString(), { method,
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': invocationId },
          ...(method === 'POST' ? { body: JSON.stringify(parameters) } : {}), redirect: 'error', signal: controller.signal })
        if (response.status >= 500 || response.status >= 300 && response.status < 400) {
          void response.body?.cancel().catch(() => {})
          throw new Error('工具接收结果不确定')
        }
        if (!response.ok) {
          void response.body?.cancel().catch(() => {})
          return { status: 'failed' as const, outputSummary: '', error: `HTTP Tool 请求被拒绝（HTTP ${response.status}）`,
            errorCode: 'http_rejected', durationMs: Date.now() - started }
        }
        const content = await readToolBody(response, controller.signal)
        return { status: 'succeeded' as const, outputSummary: content.slice(0,1000), error: '', durationMs: Date.now() - started }
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('工具调用结果待核对')) }, milliseconds) }),
    ])
  } finally { if (timer) clearTimeout(timer) }
}

async function readToolBody(response: Response, signal: AbortSignal) {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('工具返回无正文')
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  const chunks: Uint8Array[] = []; let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.length
      if (bytes > 65536) throw new Error('工具返回超过上限')
      chunks.push(value)
    }
  } finally { signal.removeEventListener('abort', abort); void reader.cancel().catch(() => {}); reader.releaseLock() }
  if (signal.aborted) throw new Error('工具调用结果待核对')
  const joined = new Uint8Array(bytes); let offset = 0
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length }
  const content = new TextDecoder('utf-8', { fatal: true }).decode(joined)
  if (!content.trim()) throw new Error('工具返回空输出，结果待核对')
  if (!response.headers.get('content-type')?.includes('application/json')) return content
  const parsed: unknown = JSON.parse(content)
  if (typeof parsed === 'string' && !parsed.trim()) throw new Error('工具返回空输出，结果待核对')
  return JSON.stringify(parsed)
}
