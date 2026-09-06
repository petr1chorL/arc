import { afterEach, describe, expect, it, vi } from 'vitest'
import { readOperationResponse, isAcceptedOperation, getOperation, reconcileOperation } from './operations'
import { runWorkflow, rerunWorkflowRun, resumeRunFromFailedNode } from './execution'
import { createRegressionRun, evaluateRubric, retestRemediationTask } from './evaluations'
import { retryHumanTaskResume } from './humanTasks'

describe('durable Operation contract', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('distinguishes accepted work from completed legacy results and announces its durable id', async () => {
    const listener = vi.fn()
    window.addEventListener('arc-operation-accepted', listener)
    const accepted = { operationId: 'op-1', status: 'queued', statusUrl: '/api/workspaces/ws/operations/op-1' }
    const value = await readOperationResponse<{ id: string }>(new Response(JSON.stringify(accepted), { status: 202 }), 'ws')
    expect(isAcceptedOperation(value)).toBe(true)
    expect(listener.mock.calls[0][0].detail).toEqual({ workspaceId: 'ws', operation: accepted })
    expect(await readOperationResponse(new Response(JSON.stringify({ id: 'run-1' }), { status: 201 }), 'ws')).toEqual({ id: 'run-1' })
    window.removeEventListener('arc-operation-accepted', listener)
  })

  it('rejects malformed acceptance rather than treating it as completion', async () => {
    await expect(readOperationResponse(new Response('{"status":"completed"}', { status: 202 }), 'ws')).rejects.toThrow('异步任务响应格式异常')
  })

  it('uses workspace-owned query paths and abort signal, never the server supplied status URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await getOperation('ws/a', 'op/a', controller.signal)
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/ws%2Fa/operations/op%2Fa', expect.objectContaining({ signal: controller.signal }))
  })

  it('requires an explicit duplicate-risk acknowledgement for manual replay', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(reconcileOperation('ws', 'op', { decision: 'retry', reason: '核对后重试' })).rejects.toThrow('重复调用风险')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('all long-operation helpers preserve 202 acceptance without coercing a completed DTO', async () => {
    const accepted = { operationId: 'op-1', status: 'queued', statusUrl: '/api/workspaces/ws/operations/op-1' }
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(accepted), { status: 202 }))))
    const values = await Promise.all([
      runWorkflow('ws', 'wf', { input: 'input' }), rerunWorkflowRun('ws', 'run'), resumeRunFromFailedNode('ws', 'run'),
      createRegressionRun('ws', { rubricId: 'rubric', samples: [{ input: 'input' }] }),
      evaluateRubric('ws', 'rubric', { artifactText: 'artifact', subjectType: 'manual_artifact' }),
      retestRemediationTask('ws', 'task'), retryHumanTaskResume('ws', 'task'),
    ])
    expect(values.every(isAcceptedOperation)).toBe(true)
  })
})
