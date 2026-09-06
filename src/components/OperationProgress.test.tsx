import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OperationProgress } from './OperationProgress'

const operation = { operationId: 'op-1', kind: 'workflow_run', status: 'needs_reconciliation', result: null, error: null, attempts: 1, createdAt: '', updatedAt: '' }
describe('OperationProgress', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })
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
})
