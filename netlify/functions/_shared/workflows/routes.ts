export type WorkflowRoute = {
  operation: 'list' | 'create' | 'get' | 'update' | 'delete' | 'validate' | 'versions' | 'publish' | 'reviewers' | 'review-groups'
  params: { workspaceId: string; workflowId?: string }
}

/** Governance only: execution and directory mutations are deliberately excluded. */
export function resolveWorkflowRoute(method: string, pathname: string): WorkflowRoute | null {
  const match = /^\/api\/workspaces\/([^/]+)\/(workflows|reviewers|review-groups)(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(pathname)
  if (!match) return null
  const workspaceId = decodeSegment(match[1])
  const workflowId = match[3] ? decodeSegment(match[3]) : undefined
  if (!workspaceId || (match[3] && !workflowId)) return null
  const verb = method.toUpperCase()
  if (match[2] !== 'workflows') {
    return verb === 'GET' && !match[3]
      ? { operation: match[2] as 'reviewers' | 'review-groups', params: { workspaceId } } : null
  }
  const operation = !workflowId ? (verb === 'GET' ? 'list' : verb === 'POST' ? 'create' : null)
    : !match[4] ? (verb === 'GET' ? 'get' : verb === 'PATCH' ? 'update' : verb === 'DELETE' ? 'delete' : null)
      : match[4] === 'validate' && verb === 'POST' ? 'validate'
        : match[4] === 'versions' && verb === 'GET' ? 'versions'
          : match[4] === 'publish' && verb === 'POST' ? 'publish' : null
  return operation ? { operation, params: { workspaceId, ...(workflowId ? { workflowId } : {}) } } : null
}

function decodeSegment(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value)
    if (Array.from(decoded).some(char => char === '/' || char === '\\' || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return undefined
    return decoded || undefined
  } catch { return undefined }
}
