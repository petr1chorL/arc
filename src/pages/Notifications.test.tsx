import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '../auth/WorkspaceContext'
import { Notifications } from './Notifications'

const workspace = {
  id: 'workspace-1',
  slug: 'ai-capability-center',
  name: 'AI 能力中心',
}

const notifications = [{
  id: 'notification-failed',
  eventType: 'run_failure',
  recipientType: 'workspace_admin',
  recipientId: 'admin@example.com',
  payload: {
    message: '运行失败通知',
    dispatch: {
      status: 'failed',
      channel: 'webhook',
      errorCode: 'channel_not_configured',
      error: 'channel_not_configured:webhook',
    },
  },
  status: 'failed',
  createdAt: '2026-06-29T08:00:00Z',
}, {
  id: 'notification-pending',
  eventType: 'human_task_due',
  recipientType: 'reviewer',
  recipientId: 'reviewer-1',
  payload: {
    message: '人工任务即将到期',
    channel: 'in_app',
  },
  status: 'pending',
  createdAt: '2026-06-29T07:50:00Z',
}, {
  id: 'notification-sent',
  eventType: 'human_task_claimed',
  recipientType: 'reviewer',
  recipientId: 'reviewer-2',
  payload: {
    message: '任务已认领',
    dispatch: {
      status: 'sent',
      channel: 'in_app',
      errorCode: '',
      error: '',
    },
  },
  status: 'sent',
  createdAt: '2026-06-29T07:40:00Z',
}]

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/w/ai-capability-center/notifications']}>
      <WorkspaceProvider workspace={workspace}>
        <Notifications />
      </WorkspaceProvider>
    </MemoryRouter>,
  )
}

describe('Notifications page', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders notification outbox summary, filters and failure evidence', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url
      if (path === '/api/workspaces/workspace-1/notifications/outbox?limit=50') {
        return new Response(JSON.stringify(notifications), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/notifications/outbox?status=failed&limit=50') {
        return new Response(JSON.stringify([notifications[0]]), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/notifications/outbox?status=failed&channel=webhook&limit=50') {
        return new Response(JSON.stringify([notifications[0]]), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/notifications/outbox?status=failed&channel=webhook&errorCode=channel_not_configured&limit=50') {
        return new Response(JSON.stringify([notifications[0]]), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    expect(await screen.findByRole('heading', { name: '通知运维' })).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('失败通知')).toBeInTheDocument()
    expect(screen.getByText('notification-failed')).toBeInTheDocument()
    expect(within(screen.getByLabelText('通知 Outbox 列表')).getByText('channel_not_configured')).toBeInTheDocument()
    expect(screen.getByText('channel_not_configured:webhook')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('状态筛选'), 'failed')
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces/workspace-1/notifications/outbox?status=failed&limit=50',
        expect.objectContaining({ credentials: 'same-origin' }),
      )
    })
    await user.selectOptions(screen.getByLabelText('渠道筛选'), 'webhook')
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces/workspace-1/notifications/outbox?status=failed&channel=webhook&limit=50',
        expect.objectContaining({ credentials: 'same-origin' }),
      )
    })
    await user.selectOptions(screen.getByLabelText('失败码筛选'), 'channel_not_configured')
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces/workspace-1/notifications/outbox?status=failed&channel=webhook&errorCode=channel_not_configured&limit=50',
        expect.objectContaining({ credentials: 'same-origin' }),
      )
    })
  })

  it('shows empty and error states clearly', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: '查询失败' }), { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/w/ai-capability-center/notifications']}>
        <WorkspaceProvider workspace={workspace}>
          <Notifications />
        </WorkspaceProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByText('当前筛选下暂无通知')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '刷新' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('查询失败')
  })
})
