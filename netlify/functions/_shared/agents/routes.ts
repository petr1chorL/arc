export type AgentRoute = {
  operation: 'list' | 'create' | 'get' | 'update' | 'versions' | 'publish' | 'deactivate' | 'activate'
  params: { workspaceId: string; agentId?: string }
}

/** Resolve only the approved governance operations, never Agent execution. */
export function resolveAgentRoute(method: string, pathname: string): AgentRoute | null {
  const match = /^\/api\/workspaces\/([^/]+)\/agents(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(pathname)
  if (!match) return null
  const workspaceId = decodeSegment(match[1])
  const agentId = match[2] ? decodeSegment(match[2]) : undefined
  if (!workspaceId || (match[2] && !agentId)) return null
  const verb = method.toUpperCase()
  if (!agentId) {
    if (verb !== 'GET' && verb !== 'POST') return null
    return { operation: verb === 'GET' ? 'list' : 'create', params: { workspaceId } }
  }
  const action = match[3]
  const operation = !action && verb === 'GET' ? 'get'
    : !action && verb === 'PATCH' ? 'update'
      : action === 'versions' && verb === 'GET' ? 'versions'
        : verb === 'POST' && (action === 'publish' || action === 'deactivate' || action === 'activate') ? action : null
  return operation ? { operation, params: { workspaceId, agentId } } : null
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
