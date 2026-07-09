import { createContext, useContext } from 'react'
import type { WorkspaceSummary } from '../types'

export interface WorkspaceContextValue {
  workspace: WorkspaceSummary
  workspaceApiPath: (path: string) => string
  workspacePath: (path?: string) => string
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext)
  if (!value) {
    throw new Error('useWorkspace 必须在 WorkspaceProvider 内使用')
  }
  return value
}
