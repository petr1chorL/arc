const hostLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i

/** Syntax validation only: this does not grant permission to call the URL. */
export function isSafeRegistrationUrl(value: unknown): boolean {
  if (typeof value !== 'string' || Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return false
  const normalized = value.trim()
  if (!normalized || Array.from(normalized).length > 500 || /[\\?#]/.test(normalized)) return false
  const match = /^https:\/\/([^/]+)(?:\/.*)?$/i.exec(normalized)
  if (!match) return false
  const authority = match[1]
  const parts = authority.split(':')
  if (parts.length > 2 || (parts.length === 2 && (!/^\d+$/.test(parts[1]) || Number(parts[1]) !== 443))) return false
  const host = parts[0]
  const labels = host.replace(/\.$/, '').split('.')
  return host.length <= 253 && labels.every(label => hostLabel.test(label))
    && !/^(?:[0-9]+|0x[0-9a-f]+)$/i.test(labels.at(-1) ?? '')
}

export class AssetConfigurationError extends Error {
  constructor() {
    super('资产配置包含不支持或不安全的字段')
    this.name = 'AssetConfigurationError'
  }
}

/** Validate non-secret registration configuration without modifying it. */
export function validateAdapterConfig(adapterType: string, config: unknown): void {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) throw new AssetConfigurationError()
  const fields = config as Record<string, unknown>
  const keys = Object.keys(fields)
  if ((adapterType === 'manual' || adapterType === 'mcp') && keys.length === 0) return
  const method = Object.hasOwn(fields, 'method') ? fields.method : 'POST'
  if (adapterType !== 'http' || keys.some(key => key !== 'url' && key !== 'method')
    || (method !== 'GET' && method !== 'POST') || !isSafeRegistrationUrl(fields.url)) {
    throw new AssetConfigurationError()
  }
}
