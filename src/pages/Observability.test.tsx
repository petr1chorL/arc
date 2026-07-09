import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  alerts: [{
    id: 'alert-run-failed-connector_auth_timeout',
    eventKey: 'run:run-failed:connector_auth_timeout',
    eventType: 'run_failure',
    severity: 'critical',
    channel: 'in_app',
    status: 'pending',
    title: 'Amazon 评论分析',
    message: '连接器鉴权超时 · Amazon 数据连接器鉴权超时',
    runId: 'run-failed',
    humanTaskId: null,
    nextAction: '检查连接器凭证、权限范围和上游接口响应时间，必要时刷新授权后重跑失败节点。',
    createdAt: '2026-06-26T08:00:00Z',
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
    failureCategory: 'connector_auth_timeout',
    failureCategoryLabel: '连接器鉴权超时',
    troubleshootingHint: '检查连接器凭证、权限范围和上游接口响应时间，必要时刷新授权后重跑失败节点。',
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
    failureCategory: 'human_review_blocked',
    failureCategoryLabel: '等待人工审核',
    troubleshootingHint: '进入人工审核页确认任务归属、SLA 和审核资格，完成通过、驳回或退回重跑决策。',
  }],
}

const detail = {
  ...overview.recentRuns[0],
  traceId: 'trace-run-failed',
  input: '拉取近 7 天评论',
  output: '',
  error: 'Amazon 数据连接器鉴权超时',
  model: 'deepseek-v4-pro',
  nodes: [{
    id: 'node-1',
    traceId: 'trace-run-failed',
    spanId: 'span-agent',
    parentSpanId: null,
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
  }, {
    id: 'node-2',
    traceId: 'trace-run-failed',
    spanId: 'span-human',
    parentSpanId: 'span-agent',
    nodeId: 'human-review',
    nodeType: 'human',
    nodeName: '人工审核',
    status: '等待审核',
    input: '等待人工复核',
    output: '',
    error: '',
    score: null,
    durationMs: 100,
    attempts: 1,
    model: '',
    promptTokens: 0,
    completionTokens: 0,
    costUsd: 0,
    startedAt: '2026-06-26T08:00:01Z',
    completedAt: null,
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
    traceId: 'trace-run-failed',
    spanId: 'span-human',
    eventType: 'human_task_created',
    actorId: 'system',
    outcome: null,
    reason: '质量门未通过',
    createdAt: '2026-06-26T08:00:02Z',
  }],
  executionEvents: [{
    id: 'run-run-failed-started',
    type: 'run_started',
    title: '运行开始',
    status: '失败',
    traceId: 'trace-run-failed',
    spanId: null,
    sourceType: 'workflow_run',
    sourceId: 'run-failed',
    occurredAt: '2026-06-26T08:00:00Z',
    summary: 'Amazon 评论分析 开始执行',
  }, {
    id: 'node-node-1',
    type: 'node_run',
    title: '数据清洗 Agent',
    status: '失败',
    traceId: 'trace-run-failed',
    spanId: 'span-agent',
    sourceType: 'node_run',
    sourceId: 'node-1',
    occurredAt: '2026-06-26T08:00:00Z',
    summary: 'agent 节点 数据清洗 Agent：失败',
  }, {
    id: 'human-task-task-1',
    type: 'human_task_created',
    title: '复核失败原因',
    status: '待认领',
    traceId: 'trace-run-failed',
    spanId: 'span-human',
    sourceType: 'human_task',
    sourceId: 'task-1',
    occurredAt: '2026-06-26T08:00:01Z',
    summary: '人工任务 复核失败原因：待认领',
  }, {
    id: 'audit-event-1',
    type: 'human_task_created',
    title: 'human_task_created',
    status: null,
    traceId: 'trace-run-failed',
    spanId: 'span-human',
    sourceType: 'audit_event',
    sourceId: 'event-1',
    occurredAt: '2026-06-26T08:00:02Z',
    summary: '质量门未通过',
  }],
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
    taskId: 'task-overdue',
    runId: 'run-failed',
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

const emptyHumanSla = {
  totals: {
    activeTasks: 0,
    unclaimed: 0,
    inReview: 0,
    dueSoon: 0,
    overdue: 0,
    escalated: 0,
    resumeFailed: 0,
  },
  risks: [],
  reviewers: [],
  groups: [],
}

const emptyCostUsage = {
  costConfigured: false,
  totals: {
    runs: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    totalCostUsd: 0,
  },
  byWorkflow: [],
  byModel: [],
}

const executionJobs = [{
  id: 'job-dead-letter',
  workspaceId: 'workspace-1',
  runId: 'run-failed',
  workflowId: 'workflow-1',
  workflowVersion: 'v1.0.0',
  jobType: 'workflow_run',
  status: 'dead_letter',
  input: '拉取近 7 天评论',
  attempts: 3,
  maxAttempts: 3,
  error: 'Agent 执行失败，请稍后重试',
  createdBy: 'user-1',
  lockedBy: 'worker-a',
  lockedUntil: '2026-06-26T08:05:00Z',
  lastHeartbeatAt: '2026-06-26T08:00:00Z',
  nextAttemptAt: null,
  createdAt: '2026-06-26T08:00:00Z',
  startedAt: '2026-06-26T08:00:00Z',
  completedAt: '2026-06-26T08:01:00Z',
  deadLetteredAt: '2026-06-26T08:01:00Z',
  canceledAt: null,
}, {
  id: 'job-queued',
  workspaceId: 'workspace-1',
  runId: 'run-waiting',
  workflowId: 'workflow-2',
  workflowVersion: 'v1.0.0',
  jobType: 'workflow_run',
  status: 'queued',
  input: '复核价格',
  attempts: 1,
  maxAttempts: 3,
  error: '',
  createdBy: 'user-1',
  lockedBy: '',
  lockedUntil: null,
  lastHeartbeatAt: null,
  nextAttemptAt: null,
  createdAt: '2026-06-26T07:50:00Z',
  startedAt: null,
  completedAt: null,
  deadLetteredAt: null,
  canceledAt: null,
}]

const executionJobDetail = {
  ...executionJobs[0],
  auditEvents: [{
    id: 'audit-requeue',
    action: 'execution_job.requeue',
    outcome: 'succeeded',
    reason: '详情页验证重投审计',
    beforeStatus: 'dead_letter',
    afterStatus: 'queued',
    runId: 'run-failed',
    workflowId: 'workflow-1',
    actorId: 'user-1',
    actorEmail: 'admin@example.com',
    createdAt: '2026-06-26T08:06:00Z',
  }],
}

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="当前筛选参数">{location.search}</output>
}

function renderPage(initialPath = '/w/ai-capability-center/observability') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <WorkspaceProvider workspace={workspace}>
        <Observability />
        <LocationProbe />
      </WorkspaceProvider>
    </MemoryRouter>,
  )
}

async function waitForQueueActionPanelToClose() {
  await waitFor(() => {
    expect(screen.queryByText('记录队列操作原因')).not.toBeInTheDocument()
  })
}

describe('Observability', () => {
  beforeEach(() => {
    vi.spyOn(document, 'cookie', 'get').mockReturnValue('')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders risk-first operations metrics and the selected run detail', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (path === '/api/workspaces/workspace-1/observability/overview') {
        return new Response(JSON.stringify(overview), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/human-sla') {
        return new Response(JSON.stringify(humanSla), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/cost-usage') {
        return new Response(JSON.stringify(costUsage), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/execution-jobs') {
        return new Response(JSON.stringify(executionJobs), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/execution-jobs/job-dead-letter') {
        return new Response(JSON.stringify(executionJobDetail), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/execution-jobs/job-dead-letter/requeue') {
        return new Response(JSON.stringify({
          ...executionJobs[0],
          status: 'queued',
          attempts: 0,
          error: '',
          lockedBy: '',
          lockedUntil: null,
          deadLetteredAt: null,
        }), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/execution-jobs/job-queued/cancel') {
        return new Response(JSON.stringify({
          ...executionJobs[1],
          status: 'canceled',
          error: '用户取消执行',
          canceledAt: '2026-06-26T08:10:00Z',
        }), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/runs/run-failed') {
        return new Response(JSON.stringify(detail), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    expect(await screen.findByRole('heading', { name: '运行观测' })).toBeInTheDocument()
    expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('失败运行')).toBeInTheDocument()
    expect(screen.getByText('失败 · 数据清洗 Agent / 连接器鉴权超时 / 查看失败节点和错误信息')).toBeInTheDocument()
    expect(screen.getAllByText('Amazon 评论分析').length).toBeGreaterThanOrEqual(1)
    expect(await screen.findByText('Amazon 数据连接器鉴权超时')).toBeInTheDocument()
    expect(screen.getAllByText('连接器鉴权超时').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('检查连接器凭证、权限范围和上游接口响应时间，必要时刷新授权后重跑失败节点。').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('告警 Outbox')).toBeInTheDocument()
    expect(screen.getByText('run_failure')).toBeInTheDocument()
    expect(screen.getByText('连接器鉴权超时 · Amazon 数据连接器鉴权超时')).toBeInTheDocument()
    expect(await screen.findByText('人工 SLA 运营')).toBeInTheDocument()
    expect(screen.getByText('活跃任务')).toBeInTheDocument()
    expect(screen.getByText('已逾期审核')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '进入人工审核页处理该任务' })).toHaveAttribute(
      'href',
      '/w/ai-capability-center/reviews?taskId=task-overdue',
    )
    expect(await screen.findByText('成本与模型调用')).toBeInTheDocument()
    expect(screen.getByText('成本单价未配置')).toBeInTheDocument()
    expect(screen.getByText('新品研究流程')).toBeInTheDocument()
    expect(screen.getByText('deepseek-v4-pro')).toBeInTheDocument()
    expect(await screen.findByText('执行队列运营')).toBeInTheDocument()
    expect(screen.getByText('死信 · workflow_run')).toBeInTheDocument()
    expect(screen.getByText('Agent 执行失败，请稍后重试')).toBeInTheDocument()
    expect(screen.getByText('worker-a · 2026/6/26 16:05:00')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: '查看详情' })[0])
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces/workspace-1/execution-jobs/job-dead-letter',
        expect.objectContaining({ credentials: 'include' }),
      )
    })
    expect(await screen.findByText('队列任务详情')).toBeInTheDocument()
    expect(screen.getByText('详情页验证重投审计')).toBeInTheDocument()
    expect(screen.getByText('dead_letter → queued')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重新入队' }))
    await user.type(screen.getByLabelText('操作原因'), '详情页验证重新入队')
    await user.click(screen.getByRole('button', { name: '确认重新入队' }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces/workspace-1/execution-jobs/job-dead-letter/requeue',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    await waitForQueueActionPanelToClose()
    const cancelButtons = screen.getAllByRole('button', { name: '取消任务' })
    await user.click(cancelButtons[cancelButtons.length - 1])
    await user.type(screen.getByLabelText('操作原因'), '详情页验证取消任务')
    await user.click(screen.getByRole('button', { name: '确认取消任务' }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces/workspace-1/execution-jobs/job-queued/cancel',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    await waitForQueueActionPanelToClose()
    expect(screen.getByText('节点执行链路')).toBeInTheDocument()
    expect(screen.getByText('Trace ID')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看审计日志' })).toHaveAttribute(
      'href',
      '/w/ai-capability-center/settings/audit?traceId=trace-run-failed',
    )
    expect(screen.getAllByText('trace-run-failed').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Trace 链路索引')).toBeInTheDocument()
    expect(screen.getByText('root 运行级事件')).toBeInTheDocument()
    expect(screen.getAllByText('Span span-agent').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('button', { name: '定位 Span span-agent' })).toBeInTheDocument()
    expect(screen.getAllByText('事件 1').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Span span-human').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('人工任务 1')).toBeInTheDocument()
    expect(screen.getByText('审计事件 1')).toBeInTheDocument()
    expect(screen.getAllByText('Span span-agent').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('父 Span root').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Span span-human').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('父 Span span-agent').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('审计 Span span-human')).toBeInTheDocument()
    expect(screen.getByText('人工审核任务')).toBeInTheDocument()
    expect(screen.getAllByText('质量门未通过').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('执行事件流')).toBeInTheDocument()
    expect(screen.getByText('运行开始')).toBeInTheDocument()
    expect(screen.getByText('workflow_run · run_started')).toBeInTheDocument()
    expect(screen.getByText('node_run · node_run')).toBeInTheDocument()
    expect(screen.getByText('human_task · human_task_created')).toBeInTheDocument()
    expect(screen.getByText('audit_event · human_task_created')).toBeInTheDocument()
    expect(screen.getAllByText('Trace trace-run-failed').length).toBeGreaterThanOrEqual(1)
  })

  it('uses the trace link map to locate and highlight a span detail', async () => {
    const user = userEvent.setup()
    const scrollIntoView = vi.fn()
    const originalScrollIntoView = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scrollIntoView
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (path === '/api/workspaces/workspace-1/observability/overview') {
        return new Response(JSON.stringify(overview), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/human-sla') {
        return new Response(JSON.stringify(humanSla), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/cost-usage') {
        return new Response(JSON.stringify(costUsage), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/execution-jobs') {
        return new Response(JSON.stringify(executionJobs), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/runs/run-failed') {
        return new Response(JSON.stringify(detail), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      renderPage()

      await screen.findByText('Trace 链路索引')
      await user.click(screen.getByRole('button', { name: '定位 Span span-agent' }))

      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
      expect(screen.getByLabelText('节点 Span span-agent')).toHaveClass('selected-trace-target')
      expect(screen.getByLabelText('Trace 卡片 Span span-agent')).toHaveClass('active')
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView
    }
  })

  it('uses the nodeRunId query parameter to highlight a node span', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (path === '/api/workspaces/workspace-1/observability/overview') {
        return new Response(JSON.stringify(overview), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/human-sla') {
        return new Response(JSON.stringify(humanSla), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/cost-usage') {
        return new Response(JSON.stringify(costUsage), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/execution-jobs') {
        return new Response(JSON.stringify(executionJobs), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/runs/run-failed') {
        return new Response(JSON.stringify(detail), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage('/w/ai-capability-center/observability?runId=run-failed&nodeRunId=node-1')

    await screen.findByText('Trace 链路索引')
    expect(screen.getByLabelText('节点 Span span-agent')).toHaveClass('selected-trace-target')
    expect(screen.getByLabelText('Trace 卡片 Span span-agent')).toHaveClass('active')
    expect(screen.getByLabelText('执行事件 node-node-1')).toHaveClass('active')
    expect(screen.getByLabelText('执行事件 human-task-task-1')).not.toHaveClass('active')
    expect(screen.getByRole('link', { name: '查看数据清洗 Agent 产出物' })).toHaveAttribute(
      'href',
      '/w/ai-capability-center/artifacts?runId=run-failed&sourceNodeRunId=node-1',
    )
    expect(screen.getByLabelText('当前筛选参数')).toHaveTextContent('nodeRunId=node-1')
  })

  it('filters execution queue jobs by selected status', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url
      if (path === '/api/workspaces/workspace-1/observability/overview') {
        return new Response(JSON.stringify(overview), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/human-sla') {
        return new Response(JSON.stringify(humanSla), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/cost-usage') {
        return new Response(JSON.stringify(costUsage), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/execution-jobs') {
        return new Response(JSON.stringify(executionJobs), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/execution-jobs?status=dead_letter') {
        return new Response(JSON.stringify([executionJobs[0]]), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/runs/run-failed') {
        return new Response(JSON.stringify(detail), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    expect(await screen.findByText('执行队列运营')).toBeInTheDocument()
    expect(screen.getByText('2 条任务')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('队列状态筛选'), 'dead_letter')

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces/workspace-1/execution-jobs?status=dead_letter',
        expect.objectContaining({ credentials: 'include' }),
      )
    })
    expect(await screen.findByText('1 条任务')).toBeInTheDocument()
    expect(screen.getByText('死信 · workflow_run')).toBeInTheDocument()
    expect(screen.queryByText('排队中 · workflow_run')).not.toBeInTheDocument()
  })

  it('records a queue operation reason before requeueing a dead-letter job', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url
      if (path === '/api/workspaces/workspace-1/observability/overview') {
        return new Response(JSON.stringify(overview), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/human-sla') {
        return new Response(JSON.stringify(humanSla), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/cost-usage') {
        return new Response(JSON.stringify(costUsage), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/execution-jobs') {
        return new Response(JSON.stringify(executionJobs), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/execution-jobs/job-dead-letter/requeue') {
        expect(init?.body).toBe(JSON.stringify({ reason: '人工确认模型恢复，重新入队' }))
        return new Response(JSON.stringify({
          ...executionJobs[0],
          status: 'queued',
          attempts: 0,
          error: '',
          lockedBy: '',
          lockedUntil: null,
          deadLetteredAt: null,
        }), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/runs/run-failed') {
        return new Response(JSON.stringify(detail), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    await screen.findByText('执行队列运营')
    await user.click(screen.getByRole('button', { name: '重新入队' }))

    expect(await screen.findByText('记录队列操作原因')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确认重新入队' }))
    expect(screen.getByRole('alert')).toHaveTextContent('请填写操作原因')

    await user.type(screen.getByLabelText('操作原因'), '人工确认模型恢复，重新入队')
    await user.click(screen.getByRole('button', { name: '确认重新入队' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces/workspace-1/execution-jobs/job-dead-letter/requeue',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    await waitForQueueActionPanelToClose()
  })

  it('shows troubleshooting guidance for dead-letter execution jobs', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url
      if (path === '/api/workspaces/workspace-1/observability/overview') {
        return new Response(JSON.stringify(overview), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/human-sla') {
        return new Response(JSON.stringify(humanSla), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/cost-usage') {
        return new Response(JSON.stringify(costUsage), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/execution-jobs') {
        return new Response(JSON.stringify(executionJobs), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/execution-jobs/job-dead-letter') {
        return new Response(JSON.stringify(executionJobDetail), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/runs/run-failed') {
        return new Response(JSON.stringify(detail), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    await user.click((await screen.findAllByRole('button', { name: '查看详情' }))[0])

    expect(await screen.findByText('队列排障建议')).toBeInTheDocument()
    expect(screen.getByText('已进入死信队列，先复核失败原因和上游依赖，再决定是否重新入队。')).toBeInTheDocument()
    expect(screen.getByText('已达到最大尝试次数 3/3，建议修复配置或输入后再重新入队。')).toBeInTheDocument()
    expect(screen.getByText('当前错误：Agent 执行失败，请稍后重试')).toBeInTheDocument()
  })

  it('highlights expired worker leases for running execution jobs', async () => {
    const user = userEvent.setup()
    const expiredRunningJob = {
      ...executionJobs[1],
      id: 'job-running-expired',
      status: 'running',
      attempts: 1,
      lockedBy: 'worker-stale',
      lockedUntil: '2026-06-26T08:05:00Z',
      lastHeartbeatAt: '2026-06-26T08:00:00Z',
      startedAt: '2026-06-26T08:00:00Z',
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url
      if (path === '/api/workspaces/workspace-1/observability/overview') {
        return new Response(JSON.stringify(overview), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/human-sla') {
        return new Response(JSON.stringify(humanSla), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/cost-usage') {
        return new Response(JSON.stringify(costUsage), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/execution-jobs') {
        return new Response(JSON.stringify([expiredRunningJob]), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/execution-jobs/job-running-expired') {
        return new Response(JSON.stringify({
          ...expiredRunningJob,
          auditEvents: [],
        }), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/runs/run-failed') {
        return new Response(JSON.stringify(detail), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    expect(await screen.findByText('运行中 · workflow_run')).toBeInTheDocument()
    expect(screen.getByText('租约已过期')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '查看详情' }))

    expect(await screen.findByText('队列排障建议')).toBeInTheDocument()
    expect(screen.getByText('Worker 租约已过期，任务可被其他 Worker 接管；如果长期停留运行中，请检查 Worker 进程。')).toBeInTheDocument()
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
      if (path === '/api/workspaces/workspace-1/observability/human-sla') {
        return new Response(JSON.stringify(humanSla), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/cost-usage') {
        return new Response(JSON.stringify(costUsage), { status: 200 })
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

    expect((await screen.findAllByText('等待人工审核')).length).toBeGreaterThanOrEqual(1)
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces/workspace-1/observability/runs/run-waiting',
        expect.objectContaining({ credentials: 'include' }),
      )
    })
  })

  it('applies status workflow risk and failure filters from the URL', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (path === '/api/workspaces/workspace-1/observability/overview') {
        return new Response(JSON.stringify(overview), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/human-sla') {
        return new Response(JSON.stringify(humanSla), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/cost-usage') {
        return new Response(JSON.stringify(costUsage), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/runs/run-waiting') {
        return new Response(JSON.stringify({
          ...overview.recentRuns[1],
          input: '复核价格',
          output: '等待人工审核',
          error: '',
          model: 'deepseek-v4-pro',
          nodes: [],
          humanTasks: [],
          auditEvents: [],
        }), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage('/w/ai-capability-center/observability?status=需介入&workflow=价格&risk=warning&failure=human_review_blocked')

    expect(await screen.findByDisplayValue('需介入')).toBeInTheDocument()
    expect(screen.getByDisplayValue('价格')).toBeInTheDocument()
    expect(screen.getByDisplayValue('中风险')).toBeInTheDocument()
    expect(screen.getByDisplayValue('等待人工审核')).toBeInTheDocument()
    expect((await screen.findAllByText('价格监控流程')).length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('Amazon 评论分析')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces/workspace-1/observability/runs/run-waiting',
        expect.objectContaining({ credentials: 'include' }),
      )
    })
  })

  it('syncs filter changes and selected run to the URL query', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (path === '/api/workspaces/workspace-1/observability/overview') {
        return new Response(JSON.stringify(overview), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/human-sla') {
        return new Response(JSON.stringify(humanSla), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/cost-usage') {
        return new Response(JSON.stringify(costUsage), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/runs/run-failed') {
        return new Response(JSON.stringify(detail), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    await user.selectOptions(await screen.findByLabelText('运行状态筛选'), '失败')
    await user.type(screen.getByLabelText('工作流名称筛选'), 'Amazon')
    await user.selectOptions(screen.getByLabelText('风险等级筛选'), 'critical')
    await user.selectOptions(screen.getByLabelText('失败原因筛选'), 'connector_auth_timeout')

    expect(screen.getByLabelText('当前筛选参数')).toHaveTextContent('status=%E5%A4%B1%E8%B4%A5')
    expect(screen.getByLabelText('当前筛选参数')).toHaveTextContent('workflow=Amazon')
    expect(screen.getByLabelText('当前筛选参数')).toHaveTextContent('risk=critical')
    expect(screen.getByLabelText('当前筛选参数')).toHaveTextContent('failure=connector_auth_timeout')
    expect(screen.getByLabelText('当前筛选参数')).toHaveTextContent('runId=run-failed')
  })

  it('shows a clear empty state when no runs exist', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (path === '/api/workspaces/workspace-1/observability/human-sla') {
        return new Response(JSON.stringify(emptyHumanSla), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/cost-usage') {
        return new Response(JSON.stringify(emptyCostUsage), { status: 200 })
      }
      return new Response(JSON.stringify({
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
        alerts: [],
        recentRuns: [],
      }), { status: 200 })
    }))

    renderPage()

    expect(await screen.findByText('暂无运行记录')).toBeInTheDocument()
    expect(screen.getByText('运行工作流或 Agent 后，这里会显示失败、人工介入和成本风险。')).toBeInTheDocument()
  })

  it('reloads human SLA risks when reviewer and group filters change', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const path = url.replace('http://localhost', '')
      if (path === '/api/workspaces/workspace-1/observability/overview') {
        return new Response(JSON.stringify(overview), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/runs/run-failed') {
        return new Response(JSON.stringify(detail), { status: 200 })
      }
      if (path === '/api/workspaces/workspace-1/observability/cost-usage') {
        return new Response(JSON.stringify(costUsage), { status: 200 })
      }
      if (path.startsWith('/api/workspaces/workspace-1/observability/human-sla')) {
        return new Response(JSON.stringify(humanSla), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    await user.selectOptions(await screen.findByLabelText('按 Reviewer 过滤'), 'reviewer-1')
    await user.selectOptions(screen.getByLabelText('按审核组过滤'), 'group-1')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/observability/human-sla?reviewerId=reviewer-1',
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/observability/human-sla?reviewerId=reviewer-1&groupId=group-1',
      expect.objectContaining({ credentials: 'include' }),
    )
  })
})
