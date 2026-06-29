import { afterEach, describe, expect, it, vi } from 'vitest'
import { dispatchNotifications, listNotifications, requeueNotification } from './notifications'

describe('Notifications API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads notification outbox records with operational filters', async () => {
    const records = [{
      id: 'notification-1',
      eventType: 'run_failure',
      recipientType: 'workspace_admin',
      recipientId: 'user-1',
      payload: {
        dispatch: {
          channel: 'webhook',
          errorCode: 'channel_not_configured',
          error: 'channel_not_configured:webhook',
        },
      },
      status: 'failed',
      createdAt: '2026-06-29T08:00:00Z',
    }]
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(records), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listNotifications('workspace-1', {
      status: 'failed',
      channel: 'webhook',
      errorCode: 'channel_not_configured',
      limit: 50,
    })).resolves.toEqual(records)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/notifications/outbox?status=failed&channel=webhook&errorCode=channel_not_configured&limit=50',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
  })

  it('requeues a failed notification with an audit reason', async () => {
    const record = {
      id: 'notification-failed',
      eventType: 'run_failure',
      recipientType: 'workspace_admin',
      recipientId: 'user-1',
      payload: {
        dispatch: {
          status: 'pending',
          reason: '渠道配置已恢复',
        },
      },
      status: 'pending',
      createdAt: '2026-06-29T08:00:00Z',
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(record), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(requeueNotification('workspace-1', 'notification-failed', '渠道配置已恢复')).resolves.toEqual(record)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/notifications/outbox/notification-failed/requeue',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({ reason: '渠道配置已恢复' }),
      }),
    )
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect((request.headers as Headers).get('Content-Type')).toBe('application/json')
  })

  it('triggers a notification dispatch pass', async () => {
    const summary = {
      processed: 2,
      sent: 1,
      failed: 1,
      items: [{
        id: 'notification-1',
        eventKey: 'task-1:webhook',
        status: 'sent',
        channel: 'webhook',
        errorCode: '',
        providerMessageId: 'provider-1',
        error: '',
      }],
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(summary), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(dispatchNotifications('workspace-1')).resolves.toEqual(summary)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/notifications/outbox/dispatch',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
      }),
    )
  })
})
