import { afterEach, describe, expect, it, vi } from 'vitest'
import { listNotifications } from './notifications'

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
})
