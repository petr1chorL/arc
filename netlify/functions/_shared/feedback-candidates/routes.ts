export type FeedbackRoute = {
  operation: 'list' | 'detail' | 'confirm'
  params: { workspaceId: string; candidateId?: string }
}

/** Resolve only the three approved candidate governance endpoints. */
export function resolveFeedbackRoute(method: string, pathname: string): FeedbackRoute | null {
  const match = /^\/api\/workspaces\/([^/]+)\/feedback-candidates(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(pathname)
  if (!match) return null
  const workspaceId = decodeSegment(match[1])
  const candidateId = match[2] ? decodeSegment(match[2]) : undefined
  if (!workspaceId || (match[2] && !candidateId)) return null
  const verb = method.toUpperCase()
  const operation = !candidateId && verb === 'GET' ? 'list'
    : candidateId && !match[3] && verb === 'GET' ? 'detail'
      : candidateId && match[3] === 'confirm' && verb === 'POST' ? 'confirm' : null
  return operation ? { operation, params: { workspaceId, ...(candidateId ? { candidateId } : {}) } } : null
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
