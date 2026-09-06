export type RubricRoute = {
  operation: 'list' | 'create' | 'update' | 'versions' | 'publish' | 'deactivate'
  params: { workspaceId: string; rubricId?: string }
}

/** Match only approved rubric governance routes, never scoring execution. */
export function resolveRubricRoute(method: string, pathname: string): RubricRoute | null {
  const match = /^\/api\/workspaces\/([^/]+)\/evaluations\/rubrics(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(pathname)
  if (!match) return null
  const workspaceId = decodeSegment(match[1])
  const rubricId = match[2] ? decodeSegment(match[2]) : undefined
  if (!workspaceId || (match[2] && !rubricId)) return null
  const verb = method.toUpperCase()
  if (!rubricId) {
    if (verb !== 'GET' && verb !== 'POST') return null
    return { operation: verb === 'GET' ? 'list' : 'create', params: { workspaceId } }
  }
  const operation = !match[3] && verb === 'PATCH' ? 'update'
    : match[3] === 'versions' && verb === 'GET' ? 'versions'
      : match[3] === 'publish' && verb === 'POST' ? 'publish'
        : match[3] === 'deactivate' && verb === 'POST' ? 'deactivate' : null
  return operation ? { operation, params: { workspaceId, rubricId } } : null
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
