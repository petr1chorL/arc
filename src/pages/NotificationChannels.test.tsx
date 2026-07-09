import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '../auth/WorkspaceContext'
import { NotificationChannels } from './NotificationChannels'

const workspace = {
  id: 'workspace-1',
  slug: 'ai-capability-center',
  name: 'AI 能力中心',
}

const channel = {
  id: 'channel-1',
  workspaceId: workspace.id,
  name: 'Webhook 告警',
  channelType: 'webhook' as const,
  status: 'active',
  config: { urlRef: 'WEBHOOK_URL' },
  secretRef: 'WEBHOOK_SECRET',
  createdAt: '2026-06-29T00:00:00Z',
  updatedAt: '2026-06-29T00:00:00Z',
}

const disabledChannel = {
  ...channel,
  status: 'disabled',
}

const failedNotifications = [
  {
    id: 'notification-1',
    eventType: 'workflow.failed',
    recipientType: 'workspace',
    recipientId: workspace.id,
    status: 'failed',
    createdAt: '2026-06-29T01:00:00Z',
    payload: {
      title: '工作流失败',
      dispatch: {
        channel: 'webhook',
        errorCode: 'notification_channel_missing',
      },
    },
  },
  {
    id: 'notification-2',
    eventType: 'human_task.sla',
    recipientType: 'reviewer',
    recipientId: 'reviewer-1',
    status: 'failed',
    createdAt: '2026-06-29T02:00:00Z',
    payload: {
      title: 'SLA 升级失败',
      dispatch: {
        channel: 'webhook',
        errorCode: 'channel_not_configured',
      },
    },
  },
]

function renderPage() {
  return render(
    <WorkspaceProvider workspace={workspace}>
      <MemoryRouter><NotificationChannels /></MemoryRouter>
    </WorkspaceProvider>,
  )
}

describe('NotificationChannels page', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads and creates notification channel assets', async () => {
    const user = userEvent.setup()
    const created = {
      ...channel,
      id: 'channel-2',
      name: '飞书提醒',
      channelType: 'feishu' as const,
      config: { appRef: 'FEISHU_APP' },
      secretRef: 'FEISHU_BOT_SECRET',
    }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === `/api/workspaces/${workspace.id}/notification-channels` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([channel]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/notifications/outbox?status=failed&limit=100` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/notification-channels` && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify(created), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    expect(await screen.findByRole('heading', { name: '通知渠道' })).toBeInTheDocument()
    expect(await screen.findByText('Webhook 告警')).toBeInTheDocument()
    expect(screen.queryByLabelText('密钥值')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('渠道名称'), '飞书提醒')
    await user.selectOptions(screen.getByLabelText('渠道类型'), 'feishu')
    await user.type(screen.getByLabelText('Secret Ref'), 'FEISHU_BOT_SECRET')
    fireEvent.change(screen.getByLabelText('配置 JSON'), { target: { value: '{ "appRef": "FEISHU_APP" }' } })
    await user.click(screen.getByRole('button', { name: '创建通知渠道' }))

    expect(await screen.findByText('飞书提醒')).toBeInTheDocument()
    const createCall = fetchMock.mock.calls.find((call) => call[1]?.method === 'POST')
    const createBody = JSON.parse(String(createCall?.[1]?.body))
    expect(createBody).toEqual({
      name: '飞书提醒',
      channelType: 'feishu',
      config: { appRef: 'FEISHU_APP' },
      secretRef: 'FEISHU_BOT_SECRET',
    })
    expect(createBody).not.toHaveProperty('secret')
    expect(createBody).not.toHaveProperty('apiKey')
  })

  it('shows failed notification impact per channel and links back to notification ops', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url
      if (url === `/api/workspaces/${workspace.id}/notification-channels` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([channel]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/notifications/outbox?status=failed&limit=100` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify(failedNotifications), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    const card = (await screen.findByText('Webhook 告警')).closest('article')
    expect(card).not.toBeNull()
    expect(card!).toHaveTextContent('失败影响')
    expect(card!).toHaveTextContent('2 条失败通知')
    expect(card!).toHaveTextContent('notification_channel_missing')
    expect(card!).toHaveTextContent('channel_not_configured')
    const impactLink = screen.getByRole('link', { name: '查看 webhook 通知失败' })
    expect(impactLink).toHaveAttribute('href', '/w/ai-capability-center/notifications?channel=webhook')
  })

  it('keeps channel assets visible when failed impact loading fails', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url
      if (url === `/api/workspaces/${workspace.id}/notification-channels` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([channel]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/notifications/outbox?status=failed&limit=100` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify({ detail: 'outbox unavailable' }), { status: 500 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    expect(await screen.findByText('Webhook 告警')).toBeInTheDocument()
    expect(await screen.findByText('失败影响面加载失败')).toBeInTheDocument()
  })

  it('blocks non-object config before submitting', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void init
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url
      if (url === `/api/workspaces/${workspace.id}/notification-channels`) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/notifications/outbox?status=failed&limit=100`) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    await screen.findByRole('heading', { name: '通知渠道' })
    await user.type(screen.getByLabelText('渠道名称'), '错误配置')
    fireEvent.change(screen.getByLabelText('配置 JSON'), { target: { value: '["bad"]' } })
    await user.click(screen.getByRole('button', { name: '创建通知渠道' }))

    expect(await screen.findByText('配置 JSON 必须是 JSON 对象')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(false)
  })

  it('disables active channels and removes the disable action', async () => {
    const user = userEvent.setup()
    const disabled = { ...channel, status: 'disabled' }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === `/api/workspaces/${workspace.id}/notification-channels` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([channel]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/notifications/outbox?status=failed&limit=100` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/notification-channels/${channel.id}/disable`) {
        return Promise.resolve(new Response(JSON.stringify(disabled), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    expect(await screen.findByText('Webhook 告警')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '停用 Webhook 告警' }))

    expect(await screen.findByText('disabled')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '停用 Webhook 告警' })).not.toBeInTheDocument()
    })
  })

  it('enables disabled channels and restores the disable action', async () => {
    const user = userEvent.setup()
    const enabled = { ...channel, status: 'active', updatedAt: '2026-06-29T03:00:00Z' }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === `/api/workspaces/${workspace.id}/notification-channels` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([disabledChannel]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/notifications/outbox?status=failed&limit=100` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/notification-channels/${channel.id}/enable`) {
        return Promise.resolve(new Response(JSON.stringify(enabled), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    expect(await screen.findByText('Webhook 告警')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '恢复启用 Webhook 告警' }))

    expect(await screen.findByText('active')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '停用 Webhook 告警' })).toBeInTheDocument()
    })
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/workspaces/${workspace.id}/notification-channels/${channel.id}/enable`,
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
