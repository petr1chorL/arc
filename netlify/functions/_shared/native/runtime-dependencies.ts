import { isNativeDeploymentEnabled } from './deployment.ts'
import { NotSentError } from '../runtime/types.ts'
import { isIP } from 'node:net'
import { createRuntimeGateway } from '../runtime/gateway.ts'
import type { RuntimeDependencies } from '../runtime/service.ts'
import type { ProviderCompatibilityOptions } from '../reference-assets/provider-compat-postgres.ts'

type Binding = Readonly<{ workspaceId: string; host: string; secretRef: string }>
export type NativeRuntimeConfig = Readonly<{
  bindings: readonly Binding[]
  toolBindings?: readonly Readonly<{ workspaceId: string; host: string }>[]
  inputCostPerMillion?: number
  outputCostPerMillion?: number
  requestTimeoutMs: number
  costConfigured: boolean
}>

export type NativeRuntimePorts = {
  mode?: string
  loadConfig: () => unknown
  resolveSecret: (ref: string) => string | undefined
  fetch?: typeof fetch
}
export type NativeRuntimeAssembly = {
  dependencies: RuntimeDependencies
  providerOptions: ProviderCompatibilityOptions
  closureOptions: { costConfigured: boolean }
}

/** Parse only explicit, non-secret runtime settings supplied by the host. */
export function parseNativeRuntimeConfig(value: unknown): NativeRuntimeConfig {
  const source = fields(value, ['bindings', 'toolBindings', 'inputCostPerMillion', 'outputCostPerMillion', 'requestTimeoutMs'])
  if (!Array.isArray(source.bindings)) throw configError()
  const bindings = source.bindings.map(parseBinding)
  if (new Set(bindings.map(binding => JSON.stringify(binding))).size !== bindings.length) throw configError()
  const toolBindings = Object.hasOwn(source, 'toolBindings') ? parseToolBindings(source.toolBindings) : undefined
  const input = source.inputCostPerMillion, output = source.outputCostPerMillion
  const costConfigured = Object.hasOwn(source, 'inputCostPerMillion') || Object.hasOwn(source, 'outputCostPerMillion')
  // The existing gateway permits at most 1e9 tokens per usage field; reject overflow before sending.
  if (costConfigured && ![input, output].every(rate => typeof rate === 'number' && Number.isFinite(rate * 2e9) && rate >= 0)) throw configError()
  const requestTimeoutMs = Object.hasOwn(source, 'requestTimeoutMs') ? source.requestTimeoutMs : 60000
  if (typeof requestTimeoutMs !== 'number' || !Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 60000) throw configError()
  return Object.freeze({ bindings: Object.freeze(bindings), requestTimeoutMs, costConfigured,
    ...(toolBindings ? { toolBindings } : {}),
    ...(costConfigured ? { inputCostPerMillion: input as number, outputCostPerMillion: output as number } : {}) })
}

function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some(key => !keys.includes(key))) throw configError()
  return value as Record<string, unknown>
}

function parseBinding(value: unknown): Binding {
  const binding = fields(value, ['workspaceId', 'host', 'secretRef'])
  if (typeof binding.secretRef !== 'string' || !/^[A-Z_][A-Z0-9_]{0,159}$/.test(binding.secretRef)) throw configError()
  return Object.freeze({ ...parseHostBinding(binding), secretRef: binding.secretRef })
}

function parseToolBindings(value: unknown) {
  if (!Array.isArray(value)) throw configError()
  const bindings = value.map(item => parseHostBinding(fields(item, ['workspaceId', 'host'])))
  if (new Set(bindings.map(binding => JSON.stringify(binding))).size !== bindings.length) throw configError()
  return Object.freeze(bindings)
}

function parseHostBinding(binding: Record<string, unknown>) {
  if (typeof binding.workspaceId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,35}$/.test(binding.workspaceId)
    || typeof binding.host !== 'string') throw configError()
  const host = binding.host.toLowerCase(), labels = host.split('.')
  if (isIP(host) || host.length > 253 || labels.length < 2
    || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw configError()
  try { if (new URL(`https://${host}`).hostname !== host) throw configError() } catch { throw configError() }
  return Object.freeze({ workspaceId: binding.workspaceId, host })
}

function configError() { return new NotSentError('运行依赖配置无效') }

/** Off means no initialization, including evaluation of configuration and transport ports. */
export function createNativeRuntimeDependencies(ports: NativeRuntimePorts): NativeRuntimeAssembly | null {
  if (!isNativeDeploymentEnabled(ports.mode)) return null
  let config: NativeRuntimeConfig
  try { config = parseNativeRuntimeConfig(ports.loadConfig()) } catch { throw configError() }
  const resolveSecret = safeSecretResolver(ports.resolveSecret)
  const gateway = createRuntimeGateway({ allowedBindings: config.bindings,
    inputCostPerMillion: config.inputCostPerMillion, outputCostPerMillion: config.outputCostPerMillion,
    requestTimeoutMs: config.requestTimeoutMs, resolveSecret, fetch: ports.fetch })
  const providerOptions: ProviderCompatibilityOptions = { secretPresence: binding => (
    isApprovedProvider(config, binding) ? Boolean(resolveSecret(binding.secretRef)) : false
  ) }
  return { dependencies: { ...gateway, ...(config.toolBindings ? { toolOptions: {
    allowedBindings: config.toolBindings, fetch: ports.fetch,
  } } : {}) }, providerOptions, closureOptions: { costConfigured: config.costConfigured } }
}

function isApprovedProvider(config: NativeRuntimeConfig, binding: { workspaceId: string; baseUrl: string; secretRef: string }): boolean {
  let url: URL
  try { url = new URL(binding.baseUrl) } catch { return false }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search
    || (url.port && url.port !== '443') || isIP(url.hostname)) return false
  return config.bindings.some(approved => approved.workspaceId === binding.workspaceId
    && approved.host === url.hostname && approved.secretRef === binding.secretRef)
}

function safeSecretResolver(resolve: NativeRuntimePorts['resolveSecret']) {
  return (ref: string): string | undefined => {
    try {
      const secret = resolve(ref)
      if (secret === undefined) return undefined
      if (typeof secret !== 'string' || !secret.trim() || /[\r\n]/.test(secret)) throw Error()
      return secret
    } catch { throw new NotSentError('外部服务凭证解析失败，未发送') }
  }
}
