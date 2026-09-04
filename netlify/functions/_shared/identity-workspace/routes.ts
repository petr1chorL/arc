export type IdentityWorkspaceRouteName =
  | 'auth.login'
  | 'auth.session'
  | 'auth.logout'
  | 'auth.change-password'
  | 'invitation.preview'
  | 'invitation.activate'
  | 'workspace.list'
  | 'workspace.create'
  | 'workspace.read'
  | 'workspace.audit.list'
  | 'workspace.permissions.read'
  | 'workspace.members.list'
  | 'workspace.invitation.create'
  | 'workspace.invitation.copy'
  | 'workspace.invitation.resend'
  | 'workspace.invitation.revoke'
  | 'workspace.member.role.update'
  | 'workspace.member.disable'
  | 'workspace.member.enable'
  | 'workspace.user.disable'
  | 'workspace.user.enable'
  | 'workspace.reviewer.save'
  | 'workspace.reviewer.revoke'

type RouteDefinition = {
  name: IdentityWorkspaceRouteName
  methods: readonly string[]
  pattern: RegExp
  params: readonly string[]
  redirectFrom: string
}

export const IDENTITY_WORKSPACE_ROUTES: readonly RouteDefinition[] = [
  route('auth.login', ['POST'], '/api/auth/login'),
  route('auth.session', ['GET'], '/api/auth/session'),
  route('auth.logout', ['POST'], '/api/auth/logout'),
  route('auth.change-password', ['POST'], '/api/auth/change-password'),
  route('invitation.activate', ['POST'], '/api/invitations/:token/activate'),
  route('invitation.preview', ['GET'], '/api/invitations/:token'),
  route('workspace.audit.list', ['GET'], '/api/workspaces/:workspaceId/audit-events'),
  route('workspace.permissions.read', ['GET'], '/api/workspaces/:workspaceId/permissions/matrix'),
  route('workspace.invitation.copy', ['POST'], '/api/workspaces/:workspaceId/invitations/:invitationId/copy'),
  route('workspace.invitation.resend', ['POST'], '/api/workspaces/:workspaceId/invitations/:invitationId/resend'),
  route('workspace.invitation.revoke', ['POST'], '/api/workspaces/:workspaceId/invitations/:invitationId/revoke'),
  route('workspace.invitation.create', ['POST'], '/api/workspaces/:workspaceId/invitations'),
  route('workspace.user.disable', ['POST'], '/api/workspaces/:workspaceId/members/:userId/user/disable'),
  route('workspace.user.enable', ['POST'], '/api/workspaces/:workspaceId/members/:userId/user/enable'),
  route('workspace.reviewer.save', ['PUT'], '/api/workspaces/:workspaceId/members/:userId/reviewer'),
  route('workspace.reviewer.revoke', ['DELETE'], '/api/workspaces/:workspaceId/members/:userId/reviewer'),
  route('workspace.member.disable', ['POST'], '/api/workspaces/:workspaceId/members/:userId/disable'),
  route('workspace.member.enable', ['POST'], '/api/workspaces/:workspaceId/members/:userId/enable'),
  route('workspace.member.role.update', ['PATCH'], '/api/workspaces/:workspaceId/members/:userId'),
  route('workspace.members.list', ['GET'], '/api/workspaces/:workspaceId/members'),
  route('workspace.read', ['GET'], '/api/workspaces/:workspaceId'),
  route('workspace.list', ['GET'], '/api/workspaces'),
  route('workspace.create', ['POST'], '/api/workspaces'),
] as const

function route(
  name: IdentityWorkspaceRouteName,
  methods: readonly string[],
  redirectFrom: string,
): RouteDefinition {
  const params: string[] = []
  const patternText = redirectFrom
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return escapeRegExp(segment)
      params.push(segment.slice(1))
      return '([^/]+)'
    })
    .join('/')
  return { name, methods, pattern: new RegExp(`^${patternText}$`), params, redirectFrom }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function resolveIdentityWorkspaceRoute(method: string, pathname: string) {
  for (const candidate of IDENTITY_WORKSPACE_ROUTES) {
    if (!candidate.methods.includes(method.toUpperCase())) continue
    const match = candidate.pattern.exec(pathname)
    if (!match) continue
    return {
      name: candidate.name,
      params: Object.fromEntries(
        candidate.params.map((name, index) => [name, decodeURIComponent(match[index + 1])]),
      ),
    }
  }
  return null
}
