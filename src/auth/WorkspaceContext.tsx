import { useMemo, type PropsWithChildren } from 'react'
import type { WorkspaceSummary } from '../types'
import { WorkspaceContext, type WorkspaceContextValue } from './workspaceContextState'

export function WorkspaceProvider({
  workspace,
  children,
}: PropsWithChildren<{ workspace: WorkspaceSummary }>) {
  const value = useMemo<WorkspaceContextValue>(() => ({
    workspace,
    workspaceApiPath(path: string) {
      const normalized = path.startsWith('/') ? path : `/${path}`
      return `/api/workspaces/${workspace.id}${normalized}`
    },
    workspacePath(path = '') {
      const normalized = path ? (path.startsWith('/') ? path : `/${path}`) : ''
      return `/w/${workspace.slug}${normalized}`
    },
  }), [workspace])

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}
