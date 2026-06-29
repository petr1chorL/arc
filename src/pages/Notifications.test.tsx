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

  it('requires a reason before requeueing a failed notification and refreshes the list', async () => {
    const user = userEvent.setup()
    const refreshedNotifications = [{
      ...notifications[0],
      status: 'pending',
      payload: {
        ...notifications[0].payload,
        dispatch: {
          status: 'pending',
          channel: 'webhook',
          reason: '渠道配置已恢复',
        },
      },
    }, notifications[1], notifications[2]]
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url
      if (path === '/api/workspaces/workspace-1/notifications/outbox?limit=50') {
        const getCount = fetchMock.mock.calls.filter(([calledInput]) => {
          const calledPath = typeof calledInput === 'string'
            ? calledInput
            : calledInput instanceof URL
              ? calledInput.pathname + calledInput.search
              : calledInput.url
          return calledPath === '/api/workspaces/workspace-1/notifications/outbox?limit=50'
        }).length
        return new Response(JSON.stringify(getCount > 1 ? refreshedNotifications : notifications), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/notifications/outbox/notification-failed/requeue') {
        return new Response(JSON.stringify(refreshedNotifications[0]), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${path} ${init?.method ?? 'GET'}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    expect(await screen.findByText('notification-failed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /重新入队 notification-pending/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /重新入队 notification-sent/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '重新入队 notification-failed' }))
    await user.click(screen.getByRole('button', { name: '确认重新入队' }))

    expect(screen.getByText('请填写重新入队原因')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/notifications/outbox/notification-failed/requeue',
      expect.anything(),
    )

    await user.type(screen.getByLabelText('重新入队原因'), '渠道配置已恢复')
    await user.click(screen.getByRole('button', { name: '确认重新入队' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces/workspace-1/notifications/outbox/notification-failed/requeue',
        expect.objectContaining({
          method: 'POST',
          credentials: 'same-origin',
          body: JSON.stringify({ reason: '渠道配置已恢复' }),
        }),
      )
    })
    await waitFor(() => {
      const listCalls = fetchMock.mock.calls.filter(([calledInput]) => {
        const calledPath = typeof calledInput === 'string'
          ? calledInput
          : calledInput instanceof URL
            ? calledInput.pathname + calledInput.search
            : calledInput.url
        return calledPath === '/api/workspaces/workspace-1/notifications/outbox?limit=50'
      })
      expect(listCalls).toHaveLength(2)
    })
  })

  it('keeps the requeue reason visible when the API fails', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url
      if (path === '/api/workspaces/workspace-1/notifications/outbox?limit=50') {
        return new Response(JSON.stringify([notifications[0]]), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/notifications/outbox/notification-failed/requeue') {
        return new Response(JSON.stringify({ detail: '重新入队失败' }), { status: 500 })
      }
      throw new Error(`Unexpected fetch: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    expect(await screen.findByText('notification-failed')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重新入队 notification-failed' }))
    await user.type(screen.getByLabelText('重新入队原因'), '渠道仍在恢复中')
    await user.click(screen.getByRole('button', { name: '确认重新入队' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('重新入队失败')
    expect(screen.getByLabelText('重新入队原因')).toHaveValue('渠道仍在恢复中')
  })

  it('triggers notification dispatch and refreshes the current list', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url
      if (path === '/api/workspaces/workspace-1/notifications/outbox?limit=50') {
        const getCount = fetchMock.mock.calls.filter(([calledInput]) => {
          const calledPath = typeof calledInput === 'string'
            ? calledInput
            : calledInput instanceof URL
              ? calledInput.pathname + calledInput.search
              : calledInput.url
          return calledPath === '/api/workspaces/workspace-1/notifications/outbox?limit=50'
        }).length
        return new Response(JSON.stringify(getCount > 1 ? [notifications[0]] : notifications), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/notifications/outbox/dispatch') {
        return new Response(JSON.stringify({
          processed: 2,
          sent: 1,
          failed: 1,
          items: [],
        }), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${path} ${init?.method ?? 'GET'}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    expect(await screen.findByText('notification-pending')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '触发发送器' }))

    expect(await screen.findByText('本次处理 2 条')).toBeInTheDocument()
    expect(screen.getByText('已发送 1 条')).toBeInTheDocument()
    expect(screen.getByText('失败 1 条')).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces/workspace-1/notifications/outbox/dispatch',
        expect.objectContaining({
          method: 'POST',
          credentials: 'same-origin',
        }),
      )
    })
    await waitFor(() => {
      const listCalls = fetchMock.mock.calls.filter(([calledInput]) => {
        const calledPath = typeof calledInput === 'string'
          ? calledInput
          : calledInput instanceof URL
            ? calledInput.pathname + calledInput.search
            : calledInput.url
        return calledPath === '/api/workspaces/workspace-1/notifications/outbox?limit=50'
      })
      expect(listCalls).toHaveLength(2)
    })
  })

  it('shows a dispatch error without rendering a fresh success summary', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url
      if (path === '/api/workspaces/workspace-1/notifications/outbox?limit=50') {
        return new Response(JSON.stringify(notifications), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/notifications/outbox/dispatch') {
        return new Response(JSON.stringify({ detail: '发送器失败' }), { status: 500 })
      }
      throw new Error(`Unexpected fetch: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    expect(await screen.findByText('notification-pending')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '触发发送器' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('发送器失败')
    expect(screen.queryByText(/本次处理/)).not.toBeInTheDocument()
  })
})
