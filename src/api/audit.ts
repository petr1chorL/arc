import type { WorkspaceAuditEvent } from '../types'
import { apiFetch, readJson } from './http'

export interface WorkspaceAuditEventFilters {
  action?: string
  targetType?: string
  outcome?: string
  limit?: number
}

export async function listWorkspaceAuditEvents(
  workspaceId: string,
  filters: WorkspaceAuditEventFilters = {},
): Promise<WorkspaceAuditEvent[]> {
  const params = new URLSearchParams()
  if (filters.action) params.set('action', filters.action)
  if (filters.targetType) params.set('targetType', filters.targetType)
  if (filters.outcome) params.set('outcome', filters.outcome)
  if (filters.limit) params.set('limit', String(filters.limit))
  const search = params.toString()
  const path = `/api/workspaces/${workspaceId}/audit-events${search ? `?${search}` : ''}`
  return readJson<WorkspaceAuditEvent[]>(await apiFetch(path))
}
