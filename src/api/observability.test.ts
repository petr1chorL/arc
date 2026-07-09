import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getCostUsageOverview,
  getHumanSlaOverview,
  listExecutionEvents,
  getObservabilityOverview,
  getObservabilityRunDetail,
} from './observability'

const overview = {
  totals: {
    totalRuns: 3,
    succeededRuns: 1,
    failedRuns: 1,
    waitingForHuman: 1,
    resumeFailed: 0,
    averageDurationMs: 1200,
    totalPromptTokens: 30,
    totalCompletionTokens: 20,
    totalCostUsd: 0.01,
  },
  risks: [],
  recentRuns: [],
}

const detail = {
  id: 'run-1',
  workflowName: '新品研究流程',
  status: '需介入',
  score: null,
  currentNode: '人工审核',
  startedAt: '2026-06-26T08:00:00Z',
  completedAt: null,
  durationMs: 1200,
  costUsd: 0.01,
  promptTokens: 12,
  completionTokens: 8,
  priority: 'warning',
  nextAction: '进入人工审核处理 Human Task',
  input: '测试',
  output: '',
  error: '',
  model: 'deepseek-v4-pro',
  nodes: [],
  humanTasks: [],
  auditEvents: [],
}

const humanSla = {
  totals: {
    activeTasks: 4,
    unclaimed: 2,
    inReview: 1,
    dueSoon: 1,
    overdue: 1,
    escalated: 1,
    resumeFailed: 1,
  },
  risks: [{
    taskId: 'task-1',
    runId: 'run-1',
    title: '已逾期审核',
    status: '待认领',
    slaStatus: '已逾期',
    severity: 'critical',
    assigneeReviewerId: null,
    assigneeGroupId: 'group-1',
    dueAt: '2026-06-26T08:40:00Z',
    escalationAt: '2026-06-26T09:40:00Z',
    nextAction: '进入人工审核页处理该任务',
  }],
  reviewers: [{ id: 'reviewer-1', name: '产品审核人' }],
  groups: [{ id: 'group-1', name: '产品审核组' }],
}

const costUsage = {
  costConfigured: false,
  totals: {
    runs: 3,
    totalPromptTokens: 170,
    totalCompletionTokens: 80,
    totalTokens: 250,
    totalCostUsd: 0.25,
  },
  byWorkflow: [{
    name: '新品研究流程',
    runs: 2,
    promptTokens: 140,
    completionTokens: 70,
    totalTokens: 210,
    costUsd: 0.21,
    averageScore: 88,
  }],
  byModel: [{
    name: 'deepseek-v4-pro',
    runs: 2,
    promptTokens: 140,
    completionTokens: 70,
    totalTokens: 210,
    costUsd: 0.21,
    averageScore: 88,
  }],
}

describe('Observability API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the workspace observability overview', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(overview), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getObservabilityOverview('workspace-1')).resolves.toEqual(overview)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/observability/overview',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
  })

  it('loads a run troubleshooting detail', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(detail), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getObservabilityRunDetail('workspace-1', 'run-1')).resolves.toEqual(detail)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/observability/runs/run-1',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
  })

  it('loads workspace execution events with optional filters', async () => {
    const events = [{
      id: 'event-1',
      type: 'run_started',
      title: '运行开始',
      status: '失败',
      traceId: 'trace-run-1',
      spanId: null,
      sourceType: 'workflow_run',
      sourceId: 'run-1',
      occurredAt: '2026-06-26T08:00:00Z',
      summary: '运行开始',
    }]
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(events), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listExecutionEvents('workspace-1', {
      runId: 'run-1',
      traceId: 'trace-run-1',
    })).resolves.toEqual(events)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/observability/execution-events?runId=run-1&traceId=trace-run-1',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
  })

  it('loads the human SLA overview with optional reviewer and group filters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(humanSla), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getHumanSlaOverview('workspace-1', {
      reviewerId: 'reviewer-1',
      groupId: 'group-1',
    })).resolves.toEqual(humanSla)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/observability/human-sla?reviewerId=reviewer-1&groupId=group-1',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
  })

  it('loads cost and model usage statistics', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(costUsage), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getCostUsageOverview('workspace-1')).resolves.toEqual(costUsage)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/observability/cost-usage',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
  })
})
