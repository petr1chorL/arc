import { useEffect, useState } from 'react'
import { useAuth } from '../auth/authContext'
import { useWorkspace } from '../auth/workspaceContextState'
import { workspaceHasCapability } from '../auth/workspaceCapabilities'
import { isAcceptedOperation, operationAcceptedEvent } from '../api/operations'
import { isRuntimeMigration } from '../api/migrationCapabilities'
import { OperationProgress } from './OperationProgress'

function readIds(key: string): string[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 200) : []
  } catch { return [] }
}

/** Store identifiers only; results and permissions are always reloaded from the current workspace. */
export function OperationCenter() {
  const { user } = useAuth()
  const { workspace, workspacePath } = useWorkspace()
  if (!user || !isRuntimeMigration()) return null
  return <WorkspaceOperations key={`${user.id}:${workspace.id}`} storageKey={`arc-operations:${user.id}:${workspace.id}`}
    workspaceId={workspace.id} workspacePath={workspacePath}
    canExecute={workspaceHasCapability(workspace, user.isOrganizationAdmin, 'run.execute')}
    canManageAssets={workspaceHasCapability(workspace, user.isOrganizationAdmin, 'agent.write')}
    canReconcile={workspaceHasCapability(workspace, user.isOrganizationAdmin, 'workspace.manage')} />
}

function WorkspaceOperations({ storageKey, workspaceId, workspacePath, canExecute, canManageAssets, canReconcile }: {
  storageKey: string; workspaceId: string; workspacePath: (path: string) => string; canExecute: boolean; canManageAssets: boolean; canReconcile: boolean
}) {
  const [ids, setIds] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get('operationId')
    return [...new Set([...readIds(storageKey), ...(requested && requested.length <= 200 ? [requested] : [])])]
  })
  useEffect(() => {
    const receive = (event: Event) => {
      const detail: unknown = (event as CustomEvent).detail
      if (!detail || typeof detail !== 'object' || !('workspaceId' in detail) || detail.workspaceId !== workspaceId
        || !('operation' in detail) || !isAcceptedOperation(detail.operation)) return
      const id = detail.operation.operationId
      setIds((current) => current.includes(id) ? current : [...current, id])
    }
    window.addEventListener(operationAcceptedEvent, receive)
    return () => window.removeEventListener(operationAcceptedEvent, receive)
  }, [workspaceId])
  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(ids)) } catch { /* The URL still permits recovery when storage is unavailable. */ }
  }, [storageKey, ids])
  if (!ids.length) return null
  return <aside className="page-stack operation-center" aria-label="持久化异步任务">
    {ids.map((operationId) => <OperationProgress key={operationId} workspaceId={workspaceId} operationId={operationId}
      canExecute={canExecute} canManageAssets={canManageAssets} canReconcile={canReconcile} workspacePath={workspacePath}
      onDismiss={() => setIds((current) => current.filter((id) => id !== operationId))} />)}
  </aside>
}
