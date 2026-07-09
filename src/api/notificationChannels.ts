import type { NotificationChannel, NotificationChannelType } from '../types'
import { apiFetch, readJson } from './http'

export interface CreateNotificationChannelInput {
  name: string
  channelType: NotificationChannelType
  config: Record<string, unknown>
  secretRef: string
}

const jsonRequest = {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
} as const

function workspacePath(workspaceId: string, path = '') {
  return `/api/workspaces/${workspaceId}/notification-channels${path}`
}

export async function listNotificationChannels(workspaceId: string): Promise<NotificationChannel[]> {
  return readJson<NotificationChannel[]>(await apiFetch(workspacePath(workspaceId)))
}

export async function createNotificationChannel(
  workspaceId: string,
  input: CreateNotificationChannelInput,
): Promise<NotificationChannel> {
  return readJson<NotificationChannel>(await apiFetch(workspacePath(workspaceId), {
    ...jsonRequest,
    body: JSON.stringify(input),
  }))
}

export async function disableNotificationChannel(
  workspaceId: string,
  channelId: string,
): Promise<NotificationChannel> {
  return readJson<NotificationChannel>(
    await apiFetch(workspacePath(workspaceId, `/${channelId}/disable`), jsonRequest),
  )
}

export async function enableNotificationChannel(
  workspaceId: string,
  channelId: string,
): Promise<NotificationChannel> {
  return readJson<NotificationChannel>(
    await apiFetch(workspacePath(workspaceId, `/${channelId}/enable`), jsonRequest),
  )
}
