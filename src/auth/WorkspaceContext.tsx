import { createContext, useContext, useMemo, type PropsWithChildren } from 'react'
import type { WorkspaceSummary } from '../types'

interface WorkspaceContextValue {
  workspace: WorkspaceSummary
  workspaceApiPath: (path: string) => string
  workspacePath: (path?: string) => string
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

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
      const normalized = path
        ? (path.startsWith('/') ? path : `/${path}`)
        : ''
      return `/w/${workspace.slug}${normalized}`
    },
  }), [workspace])

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext)
  if (!value) {
    throw new Error('useWorkspace 必须在 WorkspaceProvider 内使用')
  }
  return value
}
