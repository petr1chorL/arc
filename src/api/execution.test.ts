import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  decideReview,
  listReviews,
  listRuns,
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
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('runs published Agent and Workflow versions with task input only', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(run), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...run, kind: 'workflow' }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await runAgent('agent-1', { input: '分析需求', version: 'v1.0.0' })
    await runWorkflow('workflow-1', { input: '执行流程' })

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/agents/agent-1/test-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: '分析需求', version: 'v1.0.0' }),
    })
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/workflows/workflow-1/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: '执行流程' }),
    })
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

    await expect(listRuns()).resolves.toEqual([run])
    await expect(listReviews()).resolves.toEqual([review])
    await expect(decideReview('review-1', 'approve')).resolves.toMatchObject({ status: '已完成' })

    expect(fetchMock).toHaveBeenLastCalledWith('/api/reviews/review-1/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    })
  })
})
