import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '../auth/WorkspaceContext'
import { Observability } from './Observability'

const workspace = {
  id: 'workspace-1',
  slug: 'ai-capability-center',
  name: 'AI 能力中心',
}

const overview = {
  totals: {
    totalRuns: 3,
    succeededRuns: 1,
    failedRuns: 1,
    waitingForHuman: 1,
    resumeFailed: 1,
    averageDurationMs: 1250,
    totalPromptTokens: 120,
    totalCompletionTokens: 80,
    totalCostUsd: 0.084,
  },
  risks: [{
    runId: 'run-failed',
    title: 'Amazon 评论分析',
    severity: 'critical',
    message: '澶辫触 · 数据清洗 Agent',
    nextAction: '查看失败节点和错误信息',
  }],
  recentRuns: [{
    id: 'run-failed',
    workflowName: 'Amazon 评论分析',
    status: '失败',
    score: null,
    currentNode: '数据清洗 Agent',
    startedAt: '2026-06-26T08:00:00Z',
    completedAt: '2026-06-26T08:00:02Z',
    durationMs: 2000,
    costUsd: 0.05,
    promptTokens: 80,
    completionTokens: 20,
    priority: 'critical',
    nextAction: '查看失败节点和错误信息',
  }, {
    id: 'run-waiting',
    workflowName: '价格监控流程',
    status: '需介入',
    score: 76,
    currentNode: '人工审核',
    startedAt: '2026-06-26T07:50:00Z',
    completedAt: null,
    durationMs: 3400,
    costUsd: 0.034,
    promptTokens: 40,
    completionTokens: 60,
    priority: 'warning',
    nextAction: '进入人工审核处理 Human Task',
  }],
}

const detail = {
  ...overview.recentRuns[0],
  input: '拉取近 7 天评论',
  output: '',
  error: 'Amazon 数据连接器鉴权超时',
  model: 'deepseek-v4-pro',
  nodes: [{
    id: 'node-1',
    nodeId: 'fetch',
    nodeType: 'agent',
    nodeName: '数据清洗 Agent',
    status: '失败',
    input: '抓取评论',
    output: '',
    error: '连接器鉴权超时',
    score: null,
    durationMs: 900,
    attempts: 2,
    model: 'deepseek-v4-pro',
    promptTokens: 70,
    completionTokens: 10,
    costUsd: 0.04,
    startedAt: '2026-06-26T08:00:00Z',
    completedAt: '2026-06-26T08:00:01Z',
  }],
  humanTasks: [{
    id: 'task-1',
    title: '复核失败原因',
    status: '待认领',
    slaStatus: '即将到期',
    dueAt: '2026-06-26T09:00:00Z',
    escalationAt: '2026-06-26T10:00:00Z',
    assigneeReviewerId: null,
    assigneeGroupId: 'group-1',
  }],
  auditEvents: [{
    id: 'event-1',
    eventType: 'human_task_created',
    actorId: 'system',
    outcome: null,
    reason: '质量门未通过',
    createdAt: '2026-06-26T08:00:02Z',
  }],
}

function renderPage() {
  return render(
    <MemoryRouter>
      <WorkspaceProvider workspace={workspace}>
        <Observability />
      </WorkspaceProvider>
    </MemoryRouter>,
  )
}

describe('Observability', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders risk-first operations metrics and the selected run detail', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (path === '/api/workspaces/workspace-1/observability/overview') {
        return new Response(JSON.stringify(overview), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/runs/run-failed') {
        return new Response(JSON.stringify(detail), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    expect(await screen.findByRole('heading', { name: '运行观测' })).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('失败运行')).toBeInTheDocument()
    expect(screen.getByText('失败 · 数据清洗 Agent / 查看失败节点和错误信息')).toBeInTheDocument()
    expect(screen.getAllByText('Amazon 评论分析').length).toBeGreaterThanOrEqual(1)
    expect(await screen.findByText('Amazon 数据连接器鉴权超时')).toBeInTheDocument()
    expect(screen.getByText('节点执行链路')).toBeInTheDocument()
    expect(screen.getByText('人工审核任务')).toBeInTheDocument()
    expect(screen.getByText('质量门未通过')).toBeInTheDocument()
  })

  it('loads another run detail when a recent run is selected', async () => {
    const user = userEvent.setup()
    const waitingDetail = {
      ...overview.recentRuns[1],
      input: '复核价格',
      output: '等待人工审核',
      error: '',
      model: 'deepseek-v4-pro',
      nodes: [],
      humanTasks: [],
      auditEvents: [],
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (path === '/api/workspaces/workspace-1/observability/overview') {
        return new Response(JSON.stringify(overview), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/runs/run-failed') {
        return new Response(JSON.stringify(detail), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/runs/run-waiting') {
        return new Response(JSON.stringify(waitingDetail), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    await user.click(await screen.findByRole('button', { name: /价格监控流程/ }))

    expect(await screen.findByText('等待人工审核')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/observability/runs/run-waiting',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
  })

  it('shows a clear empty state when no runs exist', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        totals: {
          totalRuns: 0,
          succeededRuns: 0,
          failedRuns: 0,
          waitingForHuman: 0,
          resumeFailed: 0,
          averageDurationMs: 0,
          totalPromptTokens: 0,
          totalCompletionTokens: 0,
          totalCostUsd: 0,
        },
        risks: [],
        recentRuns: [],
      }), { status: 200 }),
    ))

    renderPage()

    expect(await screen.findByText('暂无运行记录')).toBeInTheDocument()
    expect(screen.getByText('运行工作流或 Agent 后，这里会显示失败、人工介入和成本风险。')).toBeInTheDocument()
  })
})
