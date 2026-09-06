export type DataObjectRoute = {
  operation: 'list' | 'create' | 'update' | 'publish' | 'versions'
  params: { workspaceId: string; definitionId?: string }
}

/** Match only the five approved governance routes. */
export function resolveDataObjectRoute(method: string, pathname: string): DataObjectRoute | null {
  const match = /^\/api\/workspaces\/([^/]+)\/data-objects(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(pathname)
  if (!match) return null
  const workspaceId = decodeSegment(match[1])
  const definitionId = match[2] ? decodeSegment(match[2]) : undefined
  if (!workspaceId || (match[2] && !definitionId)) return null
  const verb = method.toUpperCase()
  if (!definitionId) {
    if (verb !== 'GET' && verb !== 'POST') return null
    return { operation: verb === 'GET' ? 'list' : 'create', params: { workspaceId } }
  }
  const operation = !match[3] && verb === 'PATCH' ? 'update'
    : match[3] === 'publish' && verb === 'POST' ? 'publish'
      : match[3] === 'versions' && verb === 'GET' ? 'versions' : null
  return operation ? { operation, params: { workspaceId, definitionId } } : null
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
