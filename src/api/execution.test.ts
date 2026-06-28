import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cancelExecutionJob,
  decideReview,
  getExecutionJob,
  listExecutionJobs,
  listReviews,
  listRuns,
  requeueExecutionJob,
  resumeRunFromFailedNode,
  rerunWorkflowRun,
  runAgent,
  runWorkflow,
} from './execution'

const run = {
  id: 'run-1',
  kind: 'agent',
  name: '研究 Agent 测试运行',
  workflowId: null,
  workflowVersion: null,
  agentId: 'agent-1',
  agentVersion: 'v1.0.0',
  status: '已完成',
  input: '分析需求',
  output: '这是一个完整的结构化分析结果。',
  score: 100,
  model: 'configured-model',
  promptTokens: 12,
  completionTokens: 8,
  totalTokens: 20,
  costUsd: 0.001,
  durationMs: 1200,
  currentNode: '研究 Agent',
  error: '',
  startedAt: '2026-06-24T08:00:00Z',
  completedAt: '2026-06-24T08:00:01Z',
  nodes: [],
}

describe('Execution API', () => {
  const workspaceId = 'workspace-1'

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('runs published Agent and Workflow versions with task input only', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(run), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...run, kind: 'workflow' }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await runAgent(workspaceId, 'agent-1', { input: '分析需求', version: 'v1.0.0' })
    await runWorkflow(workspaceId, 'workflow-1', { input: '执行流程' })

    const [, firstInit] = fetchMock.mock.calls[0]
    expect(firstInit).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      body: JSON.stringify({ input: '分析需求', version: 'v1.0.0' }),
    })
    expect(new Headers(firstInit?.headers).get('Content-Type')).toBe('application/json')

    const [, secondInit] = fetchMock.mock.calls[1]
    expect(secondInit).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      body: JSON.stringify({ input: '执行流程' }),
    })
    expect(new Headers(secondInit?.headers).get('Content-Type')).toBe('application/json')
  })

  it('loads runs and reviews and persists a review decision', async () => {
    const review = {
      id: 'review-1',
      runId: 'run-1',
      nodeRunId: 'node-1',
      title: '复核低分产出',
      status: '待处理',
      reason: '基础质量门禁未通过',
      score: 50,
      createdAt: '2026-06-24T08:00:01Z',
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([run]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([review]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...review, status: '已完成' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listRuns(workspaceId)).resolves.toEqual([run])
    await expect(listReviews(workspaceId)).resolves.toEqual([review])
    await expect(decideReview(workspaceId, 'review-1', 'approve')).resolves.toMatchObject({ status: '已完成' })

    const [, lastInit] = fetchMock.mock.calls.at(-1) ?? []
    expect(lastInit).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      body: JSON.stringify({ decision: 'approve' }),
    })
    expect(new Headers(lastInit?.headers).get('Content-Type')).toBe('application/json')
  })

  it('reruns a workflow run from its history record', async () => {
    const rerun = {
      ...run,
      id: 'run-2',
      kind: 'workflow',
      workflowId: 'workflow-1',
      workflowVersion: 'v1.0.0',
      input: '分析需求',
      output: '重新运行后的结果。',
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(rerun), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(rerunWorkflowRun(workspaceId, 'run-1')).resolves.toEqual(rerun)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/runs/run-1/rerun',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
      }),
    )
  })

  it('reruns a workflow run with an overridden input', async () => {
    const rerun = {
      ...run,
      id: 'run-2',
      kind: 'workflow',
      workflowId: 'workflow-1',
      workflowVersion: 'v1.0.0',
      input: 'Corrected workflow input',
      output: 'Rerun output created from corrected input.',
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(rerun), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(rerunWorkflowRun(workspaceId, 'run-1', { input: 'Corrected workflow input' })).resolves.toEqual(rerun)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/runs/run-1/rerun',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({ input: 'Corrected workflow input' }),
      }),
    )
  })

  it('resumes a workflow run from its failed node', async () => {
    const resumed = {
      ...run,
      id: 'run-1',
      kind: 'workflow',
      workflowId: 'workflow-1',
      workflowVersion: 'v1.0.0',
      status: '已完成',
      output: '从失败点恢复后的结果。',
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(resumed), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(resumeRunFromFailedNode(workspaceId, 'run-1')).resolves.toEqual(resumed)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/runs/run-1/resume-from-failed-node',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
      }),
    )
  })

  it('loads execution jobs with an optional status filter', async () => {
    const jobs = [{
      id: 'job-1',
      workspaceId: workspaceId,
      runId: 'run-1',
      workflowId: 'workflow-1',
      workflowVersion: 'v1.0.0',
      jobType: 'workflow_run',
      status: 'dead_letter',
      input: '执行流程',
      attempts: 3,
      maxAttempts: 3,
      error: 'Agent 执行失败，请稍后重试',
      createdBy: 'user-1',
      lockedBy: 'worker-a',
      lockedUntil: '2026-06-27T08:05:00Z',
      lastHeartbeatAt: '2026-06-27T08:00:00Z',
      nextAttemptAt: null,
      createdAt: '2026-06-27T08:00:00Z',
      startedAt: '2026-06-27T08:00:00Z',
      completedAt: '2026-06-27T08:01:00Z',
      deadLetteredAt: '2026-06-27T08:01:00Z',
      canceledAt: null,
    }]
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(jobs), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listExecutionJobs(workspaceId, 'dead_letter')).resolves.toEqual(jobs)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/execution-jobs?status=dead_letter',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
  })

  it('loads execution job detail with audit events', async () => {
    const detail = {
      id: 'job-1',
      workspaceId: workspaceId,
      runId: 'run-1',
      workflowId: 'workflow-1',
      workflowVersion: 'v1.0.0',
      jobType: 'workflow_run',
      status: 'queued',
      input: '执行流程',
      attempts: 0,
      maxAttempts: 3,
      error: '',
      createdBy: 'user-1',
      lockedBy: '',
      lockedUntil: null,
      lastHeartbeatAt: null,
      nextAttemptAt: '2026-06-27T08:05:00Z',
      createdAt: '2026-06-27T08:00:00Z',
      startedAt: null,
      completedAt: null,
      deadLetteredAt: null,
      canceledAt: null,
      auditEvents: [{
        id: 'audit-1',
        action: 'execution_job.requeue',
        outcome: 'success',
        reason: '详情页验证重投审计',
        beforeStatus: 'dead_letter',
        afterStatus: 'queued',
        payload: { runId: 'run-1' },
        actorUserId: 'user-1',
        requestId: 'req-1',
        createdAt: '2026-06-27T08:02:00Z',
      }],
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(detail), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getExecutionJob(workspaceId, 'job-1')).resolves.toEqual(detail)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/execution-jobs/job-1',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
  })

  it('requeues a dead-letter execution job', async () => {
    const job = {
      id: 'job-1',
      workspaceId: workspaceId,
      runId: 'run-1',
      workflowId: 'workflow-1',
      workflowVersion: 'v1.0.0',
      jobType: 'workflow_run',
      status: 'queued',
      input: '执行流程',
      attempts: 0,
      maxAttempts: 3,
      error: '',
      createdBy: 'user-1',
      lockedBy: '',
      lockedUntil: null,
      lastHeartbeatAt: null,
      nextAttemptAt: '2026-06-27T08:05:00Z',
      createdAt: '2026-06-27T08:00:00Z',
      startedAt: '2026-06-27T08:00:00Z',
      completedAt: null,
      deadLetteredAt: null,
      canceledAt: null,
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(job), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(requeueExecutionJob(workspaceId, 'job-1', '人工确认模型恢复')).resolves.toEqual(job)

    const requeueRequest = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/execution-jobs/job-1/requeue',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({ reason: '人工确认模型恢复' }),
      }),
    )
    expect((requeueRequest.headers as Headers).get('Content-Type')).toBe('application/json')
  })

  it('cancels an execution job', async () => {
    const job = {
      id: 'job-1',
      workspaceId: workspaceId,
      runId: 'run-1',
      workflowId: 'workflow-1',
      workflowVersion: 'v1.0.0',
      jobType: 'workflow_run',
      status: 'canceled',
      input: '执行流程',
      attempts: 0,
      maxAttempts: 3,
      error: '用户取消执行',
      createdBy: 'user-1',
      lockedBy: '',
      lockedUntil: null,
      lastHeartbeatAt: null,
      nextAttemptAt: null,
      createdAt: '2026-06-27T08:00:00Z',
      startedAt: null,
      completedAt: '2026-06-27T08:01:00Z',
      deadLetteredAt: null,
      canceledAt: '2026-06-27T08:01:00Z',
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(job), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(cancelExecutionJob(workspaceId, 'job-1', '业务方取消本次运行')).resolves.toEqual(job)

    const cancelRequest = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/execution-jobs/job-1/cancel',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({ reason: '业务方取消本次运行' }),
      }),
    )
    expect((cancelRequest.headers as Headers).get('Content-Type')).toBe('application/json')
  })
})
