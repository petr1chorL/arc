import { useEffect } from 'react'
import { operationUpdatedEvent } from '../api/operations'

/** Refresh business views on persisted operation transitions, scoped to their workspace. */
export function useOperationUpdates(workspaceId: string, refresh: () => Promise<void>) {
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId: string }>).detail
      if (detail?.workspaceId === workspaceId) void refresh()
    }
    window.addEventListener(operationUpdatedEvent, receive)
    return () => window.removeEventListener(operationUpdatedEvent, receive)
  }, [workspaceId, refresh])
}
