import { isIP } from 'node:net'
import { NotSentError } from './types.ts'

export type ModelRequest = { workspaceId: string; baseUrl: string; secretRef: string; model: string;
  systemPrompt: string; userInput: string; temperature: number; maxOutputTokens: number }
export type ModelOutput = { content: string; model: string; promptTokens: number; completionTokens: number; costUsd: number }
export type GatewayOptions = { allowedBindings: readonly { workspaceId: string; host: string; secretRef: string }[];
  resolveSecret: (ref: string) => string | undefined; fetch?: typeof fetch;
  inputCostPerMillion?: number; outputCostPerMillion?: number; requestTimeoutMs?:number }

/** Bounded reader avoids allocating an unbounded provider response. */
async function readJson(response: Response, signal?:AbortSignal): Promise<Record<string, unknown>> {
  if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw Error('外部服务响应无效')
  const reader = response.body?.getReader()
  if (!reader) throw Error('外部服务无响应')
  const abort=()=>{void reader.cancel().catch(()=>{})}
  signal?.addEventListener('abort',abort,{once:true})
  const chunks: Uint8Array[] = []; let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.length
      if (length > 1_048_576) throw Error('外部响应超过上限')
      chunks.push(value)
    }
  } finally { signal?.removeEventListener('abort',abort);void reader.cancel().catch(() => {}); reader.releaseLock() }
  const content = new Uint8Array(length); let offset = 0
  for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.length }
  const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('外部服务响应无效')
  return parsed as Record<string, unknown>
}

const tokenCount = (value: unknown) => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 1_000_000_000) throw Error('Token 计数无效')
  return Number(value)
}

/** No implicit global credential fallback. Explicit bindings precede secret resolution. */
export function createRuntimeGateway(options: GatewayOptions) {
  function headers(workspaceId: string, raw: string, secretRef: string) {
    let url: URL
    try { url = new URL(raw) } catch { throw new NotSentError('外部地址未获准') }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || (url.port && url.port !== '443')
      || isIP(url.hostname) || url.hostname.startsWith('[') || !/^[A-Z_][A-Z0-9_]*$/.test(secretRef)
      || !options.allowedBindings.some(binding => binding.workspaceId === workspaceId && binding.host.toLowerCase() === url.hostname.toLowerCase() && binding.secretRef === secretRef)) {
      throw new NotSentError('外部地址与凭证引用未获准')
    }
    const secret = options.resolveSecret(secretRef)
    if (!secret) throw new NotSentError('外部服务凭证未配置')
    return { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }
  }
  async function post(url: string, body: unknown, requestHeaders: Record<string, string>, seconds = 60) {
    const milliseconds=options.requestTimeoutMs??seconds*1000
    if(!Number.isInteger(milliseconds)||milliseconds<1||milliseconds>60000)throw new NotSentError('请求时限配置无效')
    const controller=new AbortController()
    let timeout:ReturnType<typeof setTimeout>|undefined
    try {
      return await Promise.race([
        (async()=>readJson(await(options.fetch??fetch)(url,{method:'POST',headers:requestHeaders,body:JSON.stringify(body),redirect:'error',signal:controller.signal}),controller.signal))(),
        new Promise<never>((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(new Error('外部请求超时，结果待核对'))},Math.min(milliseconds,seconds*1000))}),
      ])
    }finally{if(timeout)clearTimeout(timeout)}
  }
  return {
    async complete(request: ModelRequest): Promise<ModelOutput> {
      if (typeof request.model!=='string' || !request.model.trim() || request.model.length>120 || !Number.isFinite(request.temperature) || request.temperature < 0 || request.temperature > 2
        || !Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens < 1 || request.maxOutputTokens > 200000) throw new NotSentError('模型配置无效')
      if([options.inputCostPerMillion??0,options.outputCostPerMillion??0].some(rate=>typeof rate!=='number'||!Number.isFinite(rate)||rate<0))throw new NotSentError('模型成本配置无效')
      const requestHeaders = headers(request.workspaceId, request.baseUrl, request.secretRef)
      const data = await post(`${request.baseUrl.replace(/\/+$/, '')}/chat/completions`, { model: request.model,
        messages: [{ role: 'system', content: request.systemPrompt }, { role: 'user', content: request.userInput }],
        temperature: request.temperature, max_tokens: request.maxOutputTokens }, requestHeaders)
      const choices = data.choices as { message?: { content?: unknown } }[] | undefined
      const usage = data.usage as Record<string, unknown> | undefined
      const content = choices?.[0]?.message?.content
      if (typeof content !== 'string' || typeof data.model !== 'string' || !usage || typeof usage!=='object' || Array.isArray(usage)) throw Error('模型响应结构无效')
      const promptTokens = tokenCount(usage.prompt_tokens), completionTokens = tokenCount(usage.completion_tokens)
      const costUsd = (promptTokens * (options.inputCostPerMillion ?? 0) + completionTokens * (options.outputCostPerMillion ?? 0)) / 1_000_000
      if (!Number.isFinite(costUsd) || costUsd < 0) throw Error('模型成本配置无效')
      return { content, model: data.model, promptTokens, completionTokens, costUsd }
    },
    async remote(request: { workspaceId: string; endpointUrl: string; secretRef: string; invocationId: string;
      runId: string; timeoutSeconds: number; payload: Record<string, unknown> }): Promise<ModelOutput> {
      if (!Number.isInteger(request.timeoutSeconds) || request.timeoutSeconds < 1 || request.timeoutSeconds > 60) throw new NotSentError('远程超时配置无效')
      const data = await post(request.endpointUrl, request.payload, { ...headers(request.workspaceId, request.endpointUrl, request.secretRef),
        'Idempotency-Key': request.invocationId, 'X-ARC-Trace-Id': request.runId }, request.timeoutSeconds)
      const usage = data.usage as Record<string, unknown> | undefined
      const allowed = ['protocolVersion', 'invocationId', 'output', 'usage', 'toolCalls']
      if (Object.keys(data).length !== allowed.length || Object.keys(data).some(key => !allowed.includes(key))
        || data.protocolVersion !== 'arc-agent-v1' || data.invocationId !== request.invocationId
        || typeof data.output !== 'string' || !data.output.trim() || !usage || typeof usage !== 'object' || Array.isArray(usage)
        || Object.keys(usage).some(key => !['model', 'promptTokens', 'completionTokens', 'costUsd'].includes(key))
        || !Array.isArray(data.toolCalls) || data.toolCalls.length > 100
        || data.toolCalls.some(item => !item || typeof item !== 'object' || Array.isArray(item))
        || typeof (usage.model ?? '') !== 'string' || String(usage.model ?? '').length > 120) throw Error('远程 Agent 响应无效')
      const costUsd = usage.costUsd ?? 0
      if (typeof costUsd !== 'number' || !Number.isFinite(costUsd) || costUsd < 0 || costUsd > 1e9) throw Error('远程成本无效')
      return { content: data.output.trim(), model: String(usage.model ?? '').trim(), promptTokens: tokenCount(usage?.promptTokens ?? 0),
        completionTokens: tokenCount(usage?.completionTokens ?? 0), costUsd }
    },
  }
}
