export type ReferenceAssetRoute = {
  kind: 'provider' | 'asset'
  operation: 'list' | 'create' | 'update' | 'deactivate' | 'impact' | 'audit' | 'invocations'
  params: { workspaceId: string; assetId?: string }
}

/** Match only the approved registration/read routes; execution remains excluded. */
export function resolveReferenceAssetRoute(method: string, pathname: string): ReferenceAssetRoute | null {
  const match = /^\/api\/workspaces\/([^/]+)\/(model-providers|asset-library)(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(pathname)
  if (!match) return null
  const workspaceId = decodeSegment(match[1])
  const assetId = match[3] ? decodeSegment(match[3]) : undefined
  if (!workspaceId || (match[3] && !assetId)) return null
  const kind = match[2] === 'model-providers' ? 'provider' : 'asset'
  const verb = method.toUpperCase()
  if (!assetId) {
    if (verb !== 'GET' && verb !== 'POST') return null
    return { kind, operation: verb === 'GET' ? 'list' : 'create', params: { workspaceId } }
  }
  if (kind === 'asset' && assetId === 'invocations' && !match[4] && verb === 'GET') {
    return { kind, operation: 'invocations', params: { workspaceId } }
  }
  const operation = !match[4] && verb === 'PATCH' ? 'update'
    : match[4] === 'deactivate' && verb === 'POST' ? 'deactivate'
      : match[4] === 'impact' && verb === 'GET' ? 'impact'
        : match[4] === 'audit-events' && verb === 'GET' ? 'audit' : null
  return operation ? { kind, operation, params: { workspaceId, assetId } } : null
}

function decodeSegment(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value)
    if (Array.from(decoded).some(char => char === '/' || char === '\\' || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return undefined
    return decoded || undefined
  } catch {
    return undefined
  }
}
