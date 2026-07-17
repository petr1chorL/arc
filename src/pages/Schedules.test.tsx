import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '../auth/WorkspaceContext'
import { Schedules } from './Schedules'

const workspace = {
  id: 'workspace-1',
  slug: 'ai-capability-center',
  name: 'AI 能力中心',
}

const schedule = {
  id: 'schedule-1',
  name: '工作日报',
  workflowId: 'workflow-1',
  workflowName: '洞察工作流',
  workflowVersionId: 'workflow-version-1',
  workflowVersion: 'v1.0.0',
  cronExpression: '0 9 * * 1-5',
  timezone: 'Asia/Shanghai',
  input: '{"topic":"daily"}',
  status: 'active',
  nextRunAt: '2026-07-20T01:00:00Z',
  lastScheduledFor: null,
  lastRunId: null,
  lastRunStatus: null,
  createdBy: 'admin-1',
  createdAt: '2026-07-18T01:00:00Z',
  updatedAt: '2026-07-18T01:00:00Z',
}

const workflow = {
  id: 'workflow-1',
  name: '洞察工作流',
  status: '已发布',
  version: 'v1.0.0',
  nodes: [],
  edges: [],
  inputSchema: { type: 'object', properties: {} },
  outputSchema: { type: 'object', properties: {} },
  createdAt: '2026-07-17T01:00:00Z',
  updatedAt: '2026-07-17T01:00:00Z',
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/w/ai-capability-center/schedules']}>
      <WorkspaceProvider workspace={workspace}>
        <Schedules />
      </WorkspaceProvider>
    </MemoryRouter>,
  )
}

describe('Schedules page', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders schedule operations and dispatch facts', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === '/api/workspaces/workspace-1/schedules') {
        return Promise.resolve(new Response(JSON.stringify([schedule]), { status: 200 }))
      }
      if (url === '/api/workspaces/workspace-1/workflows') {
        return Promise.resolve(new Response(JSON.stringify([workflow]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    }))

    renderPage()

    expect(await screen.findByRole('heading', { name: '调度中心' })).toBeInTheDocument()
    expect(screen.getByText('工作日报')).toBeInTheDocument()
    expect(screen.getByText('洞察工作流 · v1.0.0')).toBeInTheDocument()
    expect(screen.getByText('0 9 * * 1-5')).toBeInTheDocument()
    expect(screen.getByText('Asia/Shanghai')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '暂停 工作日报' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '立即执行 工作日报' })).toBeInTheDocument()
  })

  it('creates a schedule pinned to a published workflow version', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === '/api/workspaces/workspace-1/schedules' && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url === '/api/workspaces/workspace-1/workflows') {
        return Promise.resolve(new Response(JSON.stringify([workflow]), { status: 200 }))
      }
      if (url === '/api/workspaces/workspace-1/workflows/workflow-1/versions') {
        return Promise.resolve(new Response(JSON.stringify([{
          id: 'workflow-version-1',
          version: 'v1.0.0',
          snapshot: workflow,
          note: '',
          createdAt: '2026-07-17T01:00:00Z',
        }]), { status: 200 }))
      }
      if (url === '/api/workspaces/workspace-1/schedules' && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify(schedule), { status: 201 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await user.click(await screen.findByRole('button', { name: '新建调度' }))
    await user.type(screen.getByLabelText('调度名称'), '工作日报')
    await user.selectOptions(screen.getByLabelText('工作流'), 'workflow-1')
    await screen.findByRole('option', { name: 'v1.0.0' })
    fireEvent.change(screen.getByLabelText('Cron 表达式'), { target: { value: '0 9 * * 1-5' } })
    await user.click(screen.getByRole('button', { name: '保存调度' }))

    const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(createCall?.[0]).toBe('/api/workspaces/workspace-1/schedules')
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual(expect.objectContaining({
      name: '工作日报',
      workflowId: 'workflow-1',
      workflowVersion: 'v1.0.0',
      cronExpression: '0 9 * * 1-5',
      timezone: 'Asia/Shanghai',
    }))
    expect(await screen.findByText('工作日报')).toBeInTheDocument()
  })

  it('pauses and manually triggers a schedule', async () => {
    const user = userEvent.setup()
    const paused = { ...schedule, status: 'paused', nextRunAt: null }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === '/api/workspaces/workspace-1/schedules' && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([schedule]), { status: 200 }))
      }
      if (url === '/api/workspaces/workspace-1/workflows') {
        return Promise.resolve(new Response(JSON.stringify([workflow]), { status: 200 }))
      }
      if (url.endsWith('/pause') && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify(paused), { status: 200 }))
      }
      if (url.endsWith('/trigger') && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({
          id: 'dispatch-1',
          scheduleId: schedule.id,
          scheduledFor: '2026-07-18T02:00:00Z',
          status: 'enqueued',
          runId: 'run-1',
          runStatus: '排队中',
          reason: '',
          createdAt: '2026-07-18T02:00:00Z',
        }), { status: 201 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await user.click(await screen.findByRole('button', { name: '暂停 工作日报' }))
    expect(await screen.findByRole('button', { name: '恢复 工作日报' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '立即执行 工作日报' }))
    expect(await screen.findByText('已创建运行 run-1')).toBeInTheDocument()
  })
})
