import { afterEach, describe, expect, it, vi } from 'vitest'
import { getObservabilityOverview, getObservabilityRunDetail } from './observability'

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
})
