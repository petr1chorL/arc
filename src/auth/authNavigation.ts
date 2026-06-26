import type { AuthUser, WorkspaceSummary } from '../types'

export function getPreferredWorkspace(
  user: AuthUser | null,
  workspaces: WorkspaceSummary[],
): WorkspaceSummary | null {
  if (!workspaces.length) return null
  if (user?.lastWorkspaceId) {
    const matched = workspaces.find((workspace) => workspace.id === user.lastWorkspaceId)
    if (matched) return matched
  }
  return workspaces[0] ?? null
}

export function resolveAuthRedirectPath(
  preferredWorkspace: WorkspaceSummary | null,
  fromPathname: string | undefined,
): string | null {
  if (!preferredWorkspace) return null
  if (fromPathname && fromPathname !== '/login') {
    return fromPathname
  }
  return `/w/${preferredWorkspace.slug}`
}
