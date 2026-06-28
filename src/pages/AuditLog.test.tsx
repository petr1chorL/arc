import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '../auth/WorkspaceContext'
import { AuditLog } from './AuditLog'

const workspace = {
  id: 'workspace-1',
  slug: 'ai-capability-center',
  name: 'AI 能力中心',
}

const successEvent = {
  id: 'audit-1',
  action: 'tool_skill_asset.update',
  targetType: 'tool_skill_asset',
  targetId: 'asset-1',
  outcome: 'success',
  reason: '更新价格查询契约',
  actorId: 'admin',
  requestId: 'req-1',
  traceId: 'trace-1',
  spanId: null,
  createdAt: '2026-06-28T00:03:00Z',
  metadata: { assetName: '价格查询 Tool', changedFields: ['name'] },
}

const deniedEvent = {
  id: 'audit-2',
  action: 'member.invite',
  targetType: 'member',
  targetId: 'member-1',
  outcome: 'denied',
  reason: '权限不足',
  actorId: 'viewer',
  requestId: 'req-2',
  traceId: 'trace-2',
  spanId: null,
  createdAt: '2026-06-28T00:04:00Z',
  metadata: { userEmail: 'member@example.com' },
}

const runEvent = {
  id: 'audit-run',
  action: 'run.batch_rerun',
  targetType: 'run',
  targetId: 'run-1',
  outcome: 'success',
  reason: 'batch rerun from run center',
  actorId: 'admin',
  requestId: 'req-run',
  traceId: 'trace-run-1',
  spanId: null,
  createdAt: '2026-06-28T00:05:00Z',
  metadata: { sourceRunId: 'run-1' },
}

function renderPage(initialPath = '/w/ai-capability-center/settings/audit') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <WorkspaceProvider workspace={workspace}>
        <AuditLog />
      </WorkspaceProvider>
    </MemoryRouter>,
  )
}

describe('AuditLog page', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads workspace audit events and filters by outcome', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      if (url.includes('outcome=denied')) {
        return Promise.resolve(new Response(JSON.stringify([deniedEvent]), { status: 200 }))
      }
      if (url.startsWith(`/api/workspaces/${workspace.id}/audit-events`)) {
        return Promise.resolve(new Response(JSON.stringify([successEvent]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    expect(await screen.findByRole('heading', { name: 'Workspace 审计事件' })).toBeInTheDocument()
    expect(screen.getByText('tool_skill_asset.update')).toBeInTheDocument()
    expect(screen.getByText(/价格查询 Tool/)).toBeInTheDocument()
    expect(screen.getByText('admin')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('结果'), { target: { value: 'denied' } })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        `/api/workspaces/${workspace.id}/audit-events?outcome=denied&limit=50`,
        expect.objectContaining({ credentials: 'same-origin' }),
      )
    })
    expect(await screen.findByText('member.invite')).toBeInTheDocument()
    expect(screen.getByText('权限不足')).toBeInTheDocument()
    expect(screen.queryByText('apiKey')).not.toBeInTheDocument()
  })

  it('loads the trace id filter from the URL and keeps it in audit requests', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      if (url.includes('traceId=trace-1')) {
        return Promise.resolve(new Response(JSON.stringify([successEvent]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage('/w/ai-capability-center/settings/audit?traceId=trace-1')

    expect(await screen.findByRole('heading', { name: 'Workspace 审计事件' })).toBeInTheDocument()
    expect(screen.getByLabelText('Trace ID')).toHaveValue('trace-1')
    expect(screen.getByText('当前 Trace 过滤')).toBeInTheDocument()
    expect(screen.getByText('trace-1')).toBeInTheDocument()
    expect(screen.getByText('tool_skill_asset.update')).toBeInTheDocument()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/workspaces/${workspace.id}/audit-events?traceId=trace-1&limit=50`,
        expect.objectContaining({ credentials: 'same-origin' }),
      )
    })
  })

  it('links run audit events back to the run detail page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify([runEvent]), { status: 200 }),
    ))

    renderPage()

    expect(await screen.findByText('run.batch_rerun')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看运行' })).toHaveAttribute(
      'href',
      '/w/ai-capability-center/runs?runId=run-1',
    )
  })
})
