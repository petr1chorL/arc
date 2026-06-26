import type { PropsWithChildren, ReactNode } from 'react'
import type { WorkspaceCapability, WorkspaceRole, WorkspaceSummary } from '../types'
import { useAuth } from './AuthProvider'
import { useWorkspace } from './WorkspaceContext'

const roleRank: Record<WorkspaceRole, number> = {
  viewer: 1,
  operator: 2,
  builder: 3,
  workspace_admin: 4,
}

const minimumRole: Record<WorkspaceCapability, WorkspaceRole> = {
  'asset.read': 'viewer',
  'run.read': 'viewer',
  'audit.read': 'workspace_admin',
  'run.execute': 'operator',
  'agent.write': 'builder',
  'agent.publish': 'builder',
  'workflow.write': 'builder',
  'workflow.publish': 'builder',
  'asset.deactivate': 'workspace_admin',
  'member.manage': 'workspace_admin',
  'reviewer.manage': 'workspace_admin',
  'workspace.manage': 'workspace_admin',
  'audit.export': 'workspace_admin',
}

export function workspaceHasCapability(
  workspace: WorkspaceSummary,
  isOrganizationAdmin: boolean | undefined,
  capability: WorkspaceCapability,
): boolean {
  if (workspace.capabilities?.includes(capability)) return true
  if (isOrganizationAdmin) return true
  if (!workspace.role) return false
  return roleRank[workspace.role] >= roleRank[minimumRole[capability]]
}

export function CapabilityGuard({
  capability,
  fallback = null,
  children,
}: PropsWithChildren<{
  capability: WorkspaceCapability
  fallback?: ReactNode
}>) {
  const { user } = useAuth()
  const { workspace } = useWorkspace()
  return workspaceHasCapability(workspace, user?.isOrganizationAdmin, capability)
    ? <>{children}</>
    : <>{fallback}</>
}
