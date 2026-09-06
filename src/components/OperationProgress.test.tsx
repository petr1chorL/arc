import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OperationProgress } from './OperationProgress'

const operation = { operationId: 'op-1', kind: 'workflow_run', status: 'needs_reconciliation', result: null, error: null, attempts: 1, createdAt: '', updatedAt: '' }
describe('OperationProgress', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })
  it('does not let run operators control a Tool operation and hides Tool result payloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ ...operation, kind: 'tool.test', status: 'queued' })))))
    render(<OperationProgress workspaceId="ws" operationId="op-1" canExecute canReconcile={false} />)
    await screen.findByText('已接收，排队中')
    expect(screen.queryByRole('button', { name: '取消后续执行' })).not.toBeInTheDocument()
  })
  it('uses agent.write for Tool controls and still requires workspace management for reconciliation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ ...operation, kind: 'tool.test', status: 'failed' })))))
    const view = render(<OperationProgress workspaceId="ws" operationId="op-1" canExecute={false} canManageAssets canReconcile={false} />)
    await screen.findByText('失败')
    expect(screen.getByRole('button', { name: '重新排队' })).toBeDisabled()
    view.unmount()
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ ...operation, kind: 'tool.test' })))))
    render(<OperationProgress workspaceId="ws" operationId="op-1" canExecute canManageAssets={false} canReconcile />)
    await screen.findByText('结果待核对')
    expect(screen.queryByRole('button', { name: '确认失败，不重发' })).not.toBeInTheDocument()
  })
  it('shows acceptance as pending and refuses automatic replay of an uncertain effect', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(operation)))
    vi.stubGlobal('fetch', fetchMock)
    render(<OperationProgress workspaceId="ws" operationId="op-1" canExecute canReconcile />)
    expect(screen.getByText('正在查询任务状态…')).toBeInTheDocument()
    await screen.findByText('结果待核对')
    expect(screen.queryByText('已完成')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认风险并重新尝试' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('核对依据 / 操作原因'), { target: { value: '供应商确认未生成结果' } })
    fireEvent.click(screen.getByLabelText('我已核对，接受重复调用或重复计费的风险'))
    expect(screen.getByRole('button', { name: '确认风险并重新尝试' })).toBeEnabled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('does not expose mutation controls to a read-only viewer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(operation))))
    render(<OperationProgress workspaceId="ws" operationId="op-1" canExecute={false} canReconcile={false} />)
    await screen.findByText('结果待核对')
    expect(screen.queryByRole('button', { name: '确认风险并重新尝试' })).not.toBeInTheDocument()
  })
  it('aborts polling on unmount so old workspace requests cannot update the next view', async () => {
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_url, init) => { signal = init.signal; return new Promise(() => {}) }))
    const view = render(<OperationProgress workspaceId="ws" operationId="op-1" canExecute={false} canReconcile={false} />)
    await waitFor(() => expect(signal).toBeDefined())
    view.unmount()
    expect(signal?.aborted).toBe(true)
  })
  it('removes cached results and controls after server-side permission revocation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(operation)))
      .mockResolvedValueOnce(new Response('{"detail":"权限已撤销"}', { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<OperationProgress workspaceId="ws" operationId="op-1" canExecute canReconcile />)
    await screen.findByText('结果待核对')
    fireEvent.change(screen.getByLabelText('核对依据 / 操作原因'), { target: { value: '不再重发' } })
    fireEvent.click(screen.getByRole('button', { name: '确认失败，不重发' }))
    await screen.findByText('权限已撤销')
    expect(screen.queryByRole('button', { name: '确认失败，不重发' })).not.toBeInTheDocument()
  })
  it('bounds a stalled status request and offers a query retry without reposting work', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    vi.stubGlobal('fetch', fetchMock)
    render(<OperationProgress workspaceId="ws" operationId="op-1" canExecute={false} canReconcile={false} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    expect(screen.getByText('任务状态查询超时，请重试查询；任务未被重新提交')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试查询' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('ignores a late control response after the displayed Workspace and operation change', async () => {
    let finish!: (response: Response) => void
    const control = new Promise<Response>(resolve => { finish = resolve })
    let newReads = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return control
      if (String(input).includes('/other/')) {
        if (++newReads > 1) return new Promise(() => {})
        return Promise.resolve(new Response(JSON.stringify({ ...operation, operationId: 'op-other', kind: 'tool.test', status: 'succeeded' })))
      }
      return Promise.resolve(new Response(JSON.stringify({ ...operation, kind: 'tool.test', status: 'queued' })))
    }))
    const view = render(<OperationProgress workspaceId="ws" operationId="op-1" canExecute canManageAssets canReconcile />)
    await screen.findByText('已接收，排队中')
    fireEvent.change(screen.getByLabelText('核对依据 / 操作原因'), { target: { value: '停止后续执行' } })
    fireEvent.click(screen.getByRole('button', { name: '取消后续执行' }))
    view.rerender(<OperationProgress workspaceId="other" operationId="op-other" canExecute canManageAssets canReconcile />)
    await screen.findByText('已完成')
    await act(async () => { finish(new Response(JSON.stringify({ ...operation, kind: 'tool.test', status: 'canceled', error: '旧操作返回' }))); await control })
    expect(screen.queryByText('旧操作返回')).not.toBeInTheDocument()
    expect(screen.getByText('已完成')).toBeInTheDocument()
  })
})
