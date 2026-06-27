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

function renderPage() {
  return render(
    <WorkspaceProvider workspace={workspace}>
      <MemoryRouter><AuditLog /></MemoryRouter>
    </WorkspaceProvider>,
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
})
