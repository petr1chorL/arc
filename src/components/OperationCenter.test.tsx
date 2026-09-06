import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '../auth/WorkspaceContext'
import { OperationCenter } from './OperationCenter'
import { operationAcceptedEvent } from '../api/operations'

vi.mock('../auth/authContext', () => ({ useAuth: () => ({ user: { id: 'user-1', isOrganizationAdmin: false } }) }))
const workspace = { id: 'ws-1', slug: 'one', name: 'One', role: 'viewer' as const }
const completed = { operationId: 'op-1', kind: 'workflow_run', status: 'succeeded', result: { runId: 'run-1' }, error: null, attempts: 1, createdAt: '', updatedAt: '' }

describe('durable operation recovery', () => {
  beforeEach(() => vi.stubEnv('VITE_ARC_ONE_MIGRATION_MODE', 'runtime'))
  afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
  it('never queries native operations in the default legacy mode, including stale stored task IDs', () => {
    vi.stubEnv('VITE_ARC_ONE_MIGRATION_MODE', '')
    sessionStorage.setItem('arc-operations:user-1:ws-1', '["op-1"]')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<WorkspaceProvider workspace={workspace}><OperationCenter /></WorkspaceProvider>)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('持久化异步任务')).not.toBeInTheDocument()
  })
  it('recovers IDs after remount, reloads persisted results, and never exposes another workspace task', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(completed))))
    vi.stubGlobal('fetch', fetchMock)
    const view = render(<WorkspaceProvider workspace={workspace}><OperationCenter /></WorkspaceProvider>)
    act(() => { window.dispatchEvent(new CustomEvent(operationAcceptedEvent, { detail: { workspaceId: 'ws-1', operation: {
      operationId: 'op-1', status: 'queued', statusUrl: 'https://untrusted.example/status',
    } } })) })
    await screen.findByText('已完成')
    expect(sessionStorage.getItem('arc-operations:user-1:ws-1')).toBe('["op-1"]')
    view.unmount()
    const recovered = render(<WorkspaceProvider workspace={workspace}><OperationCenter /></WorkspaceProvider>)
    await screen.findByText('已完成')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    recovered.rerender(<WorkspaceProvider workspace={{ ...workspace, id: 'ws-2', slug: 'two' }}><OperationCenter /></WorkspaceProvider>)
    expect(screen.queryByText('op-1')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('ws-2/operations/op-1'), expect.anything())
  })
  it('ignores late accepted events from the previous workspace', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<WorkspaceProvider workspace={workspace}><OperationCenter /></WorkspaceProvider>)
    act(() => { window.dispatchEvent(new CustomEvent(operationAcceptedEvent, { detail: { workspaceId: 'other', operation: {
      operationId: 'op-1', status: 'queued', statusUrl: '/ignored',
    } } })) })
    await waitFor(() => expect(sessionStorage.getItem('arc-operations:user-1:ws-1')).toBe('[]'))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
