import { useEffect, useState } from 'react'
import { operationStatusLabels, operationUpdatedEvent, type AcceptedOperation, type Operation } from '../api/operations'

/** Submission notices follow the same persisted status as the task center, avoiding stale pending claims. */
export function useOperationNotice(workspaceId: string) {
  const [state, setState] = useState<{ id: string; label: string; notice: string } | null>(null)
  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId: string; operation: Operation }>).detail
      if (detail?.workspaceId !== workspaceId || detail.operation.status === 'queued') return
      setState((current) => current?.id === detail.operation.operationId
        ? { ...current, notice: `${current.label}：${operationStatusLabels[detail.operation.status]}。` } : current)
    }
    window.addEventListener(operationUpdatedEvent, update)
    return () => window.removeEventListener(operationUpdatedEvent, update)
  }, [workspaceId])
  return { notice: state?.notice ?? '', accepted(operation: AcceptedOperation, label: string, notice: string) {
    setState({ id: operation.operationId, label, notice })
  } }
}
