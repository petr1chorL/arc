import type { PropsWithChildren, ReactNode } from 'react'
import type { WorkspaceCapability } from '../types'
import { useAuth } from './authContext'
import { useWorkspace } from './workspaceContextState'
import { workspaceHasCapability } from './workspaceCapabilities'

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
