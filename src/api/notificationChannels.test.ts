import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createNotificationChannel,
  disableNotificationChannel,
  enableNotificationChannel,
  listNotificationChannels,
} from './notificationChannels'

const channel = {
  id: 'channel-1',
  workspaceId: 'workspace-1',
  name: 'Webhook 告警',
  channelType: 'webhook' as const,
  status: 'active',
  config: { urlRef: 'WEBHOOK_URL' },
  secretRef: 'WEBHOOK_SECRET',
  createdAt: '2026-06-29T00:00:00Z',
  updatedAt: '2026-06-29T00:00:00Z',
}

describe('Notification Channel API', () => {
  const workspaceId = 'workspace-1'

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists and creates notification channel assets without secret values', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([channel]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(channel), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listNotificationChannels(workspaceId)).resolves.toEqual([channel])
    await expect(createNotificationChannel(workspaceId, {
      name: channel.name,
      channelType: channel.channelType,
      config: channel.config,
      secretRef: channel.secretRef,
    })).resolves.toEqual(channel)

    expect(fetchMock.mock.calls[0][0]).toBe('/api/workspaces/workspace-1/notification-channels')
    const [, createInit] = fetchMock.mock.calls[1]
    expect(createInit).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
    })
    const body = JSON.parse(String(createInit?.body))
    expect(body).toEqual({
      name: channel.name,
      channelType: channel.channelType,
      config: channel.config,
      secretRef: channel.secretRef,
    })
    expect(body).not.toHaveProperty('secret')
    expect(body).not.toHaveProperty('apiKey')
  })

  it('disables notification channel assets through the workspace endpoint', async () => {
    const disabled = { ...channel, status: 'disabled' }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(disabled), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(disableNotificationChannel(workspaceId, channel.id)).resolves.toEqual(disabled)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/notification-channels/channel-1/disable',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
      }),
    )
  })

  it('enables notification channel assets through the workspace endpoint', async () => {
    const enabled = { ...channel, status: 'active' }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(enabled), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(enableNotificationChannel(workspaceId, channel.id)).resolves.toEqual(enabled)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/notification-channels/channel-1/enable',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
      }),
    )
  })
})
