import type { NotificationOutboxItem } from '../types'
import { apiFetch, readJson } from './http'

export interface NotificationFilters {
  status?: string
  channel?: string
  errorCode?: string
  limit?: number
}

function workspacePath(workspaceId: string, path = '') {
  return `/api/workspaces/${workspaceId}/notifications${path}`
}

export async function listNotifications(
  workspaceId: string,
  filters: NotificationFilters = {},
): Promise<NotificationOutboxItem[]> {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.channel) params.set('channel', filters.channel)
  if (filters.errorCode) params.set('errorCode', filters.errorCode)
  params.set('limit', String(filters.limit ?? 50))
  return readJson<NotificationOutboxItem[]>(
    await apiFetch(workspacePath(workspaceId, `/outbox?${params.toString()}`)),
  )
}
