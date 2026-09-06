import { ApiError } from '../identity-workspace/handler.ts'
import { isSafeRegistrationUrl } from '../reference-assets/policy.ts'

export type AgentFields = {
  name: string; role: string; owner: string; model: string; model_provider_id: string | null
  model_provider: string; model_base_url: string; temperature: number; max_output_tokens: number
  runtime_manifest: Record<string, unknown>
}
const invalid = () => new ApiError(422, 'Agent 请求字段不符合要求')

/** Registration only; never contact the URL or resolve secret labels. */
export function normalizeManifest(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  const manifest = value as Record<string, unknown>
  const keys = Object.keys(manifest)
  if (!keys.length) return {}
  const allowed = ['runtime', 'sourceType', 'protocolVersion', 'endpointUrl', 'secretRef', 'timeoutSeconds']
  const url = typeof manifest.endpointUrl === 'string' ? manifest.endpointUrl.trim() : ''
  const secret = typeof manifest.secretRef === 'string' ? manifest.secretRef.trim() : ''
  if (keys.length !== allowed.length || keys.some(key => !allowed.includes(key))
    || manifest.runtime !== 'remote_http' || manifest.sourceType !== 'remote_api' || manifest.protocolVersion !== 'arc-agent-v1'
    || !isSafeRegistrationUrl(url) || !/^[A-Z_][A-Z0-9_]*$/.test(secret)
    || typeof manifest.timeoutSeconds !== 'number' || !Number.isInteger(manifest.timeoutSeconds)
    || manifest.timeoutSeconds < 1 || manifest.timeoutSeconds > 60) throw invalid()
  return { runtime: 'remote_http', sourceType: 'remote_api', protocolVersion: 'arc-agent-v1',
    endpointUrl: url, secretRef: secret, timeoutSeconds: manifest.timeoutSeconds }
}

/** Preserve create aliases/defaults and ignore extra fields as the Python schema does. */
export function parseAgentCreate(value: unknown): AgentFields {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  const body = value as Record<string, unknown>
  const field = (snake: string, alias = snake, fallback?: unknown) => Object.hasOwn(body, alias)
    ? body[alias] : Object.hasOwn(body, snake) ? body[snake] : fallback
  const text = (value: unknown, max: number, nonblank = true) => {
    if (typeof value !== 'string' || Array.from(value).length > max || (nonblank && !value.trim())) throw invalid()
    return value.trim()
  }
  const number = (value: unknown, min: number, max: number, integer = false) => {
    if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'boolean') throw invalid()
    if (typeof value === 'string') {
      const pattern = integer ? /^[+-]?\d(?:_?\d)*(?:\.\d(?:_?\d)*)?$/
        : /^[+-]?(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:e[+-]?\d(?:_?\d)*)?$/i
      if (!pattern.test(value.trim())) throw invalid()
    }
    const result = Number(typeof value === 'string' ? value.replaceAll('_', '') : value)
    if (!Number.isFinite(result) || result < min || result > max || (integer && !Number.isInteger(result))) throw invalid()
    return result
  }
  const providerId = field('model_provider_id', 'modelProviderId', null)
  if (providerId !== null && (typeof providerId !== 'string' || !providerId.trim() || Array.from(providerId).length > 36)) throw invalid()
  const url = text(field('model_base_url', 'modelBaseUrl', ''), 500, false)
  if (url && !isSafeRegistrationUrl(url)) throw invalid()
  return {
    name: text(field('name'), 80), role: text(field('role'), 240), owner: text(field('owner'), 80),
    model: text(field('model'), 80), model_provider_id: providerId as string | null,
    model_provider: text(field('model_provider', 'modelProvider', 'openai-compatible'), 80), model_base_url: url,
    temperature: number(field('temperature', 'temperature', 0.2), 0, 2),
    max_output_tokens: number(field('max_output_tokens', 'maxOutputTokens', 2000), 1, 200000, true),
    runtime_manifest: normalizeManifest(field('runtime_manifest', 'runtimeManifest', {})),
  }
}

/** PATCH validates only supplied fields; null Provider is the sole nullable update. */
export function parseAgentUpdate(value: unknown): Partial<AgentFields> & { system_prompt?: string; tools?: string[]; skills?: string[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  const body = value as Record<string, unknown>
  const aliases: Record<string, string> = { model_provider_id: 'modelProviderId', model_provider: 'modelProvider',
    model_base_url: 'modelBaseUrl', max_output_tokens: 'maxOutputTokens', runtime_manifest: 'runtimeManifest' }
  const parsed = parseAgentCreate({ name: '_', role: '_', owner: '_', model: '_', ...body })
  const updates: Partial<AgentFields> & { system_prompt?: string; tools?: string[]; skills?: string[] } = Object.fromEntries(
    Object.entries(parsed).filter(([key]) => Object.hasOwn(body, key) || Object.hasOwn(body, aliases[key] ?? key)))
  if (updates.model_provider_id !== undefined && updates.model_provider_id !== null) {
    if (!updates.model_provider_id.trim()) throw invalid()
    updates.model_provider_id = updates.model_provider_id.trim()
  }
  if (Object.hasOwn(body, 'systemPrompt') || Object.hasOwn(body, 'system_prompt')) {
    const prompt = Object.hasOwn(body, 'systemPrompt') ? body.systemPrompt : body.system_prompt
    if (typeof prompt !== 'string' || Array.from(prompt).length > 20000) throw invalid()
    updates.system_prompt = prompt
  }
  for (const key of ['tools', 'skills'] as const) {
    if (!Object.hasOwn(body, key)) continue
    const names = body[key]
    if (!Array.isArray(names) || names.some(name => typeof name !== 'string')) throw invalid()
    updates[key] = names as string[]
  }
  return updates
}
