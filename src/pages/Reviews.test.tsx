import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '../auth/authContext'
import { WorkspaceProvider } from '../auth/WorkspaceContext'
import { Reviews } from './Reviews'

const workspace = {
  id: 'workspace-1',
  slug: 'ai-capability-center',
  name: 'AI 能力中心',
}

const reviewers = [
  { id: 'reviewer-1', userId: 'user-reviewer-1', name: '林晓', role: '产品审核人', isExpert: false, isActive: true },
  { id: 'reviewer-2', userId: 'user-reviewer-2', name: '陈卓', role: '质量专家', isExpert: true, isActive: true },
]

const groups = [
  {
    id: 'group-product',
    name: '产品审核组',
    assignmentMode: 'group_claim',
    isEscalationGroup: false,
    members: reviewers,
  },
  {
    id: 'group-escalation',
    name: '升级审核组',
    assignmentMode: 'round_robin',
    isEscalationGroup: true,
    members: [reviewers[1]],
  },
]

const task = {
  id: 'task-1',
  workflowRunId: 'run-1',
  nodeRunId: 'node-human',
  humanNodeId: 'human-1',
  sourceNodeId: 'agent-1',
  artifactVersionId: 'artifact-v1',
  title: '新品定义人工审核',
  status: '待认领',
  assignmentType: 'group_claim',
  assigneeReviewerId: null,
  assigneeGroupId: 'group-product',
  reviewPolicy: 'threshold',
  requiredApprovals: 2,
  participantSnapshot: ['reviewer-1', 'reviewer-2'],
  dueAt: '2026-06-25T03:00:00Z',
  escalationAt: '2026-06-25T04:00:00Z',
  slaStatus: '即将到期',
  escalationGroupId: 'group-escalation',
  createdAt: '2026-06-25T01:00:00Z',
  updatedAt: '2026-06-25T01:00:00Z',
}

const taskFromLink = {
  ...task,
  id: 'task-from-link',
  title: '从 SLA 风险进入的任务',
  artifactVersionId: 'artifact-link-v1',
}

const mojibakeSlaTask = {
  ...task,
  id: 'task-mojibake-sla',
  title: '历史 SLA 状态任务',
  artifactVersionId: 'artifact-mojibake-v1',
  slaStatus: '宸查€炬湡',
}

const detail = {
  ...task,
  artifact: {
    id: 'artifact-v1',
    version: 1,
    content: '这是 Agent 生成、等待人工判断的原始业务结论。',
    createdBy: 'system',
    createdAt: '2026-06-25T01:00:00Z',
  },
  run: {
    id: 'run-1',
    name: '新品研究流程',
    status: '等待审核',
    currentNode: '新品定义人工审核',
    score: 82,
  },
  approvalProgress: { required: 2, received: 1 },
  auditEvents: [
    {
      id: 'audit-1',
      eventType: 'task_created',
      actorId: 'system',
      reason: '',
      beforeStatus: '',
      afterStatus: '待认领',
      payload: {},
      createdAt: '2026-06-25T01:00:00Z',
    },
  ],
  notifications: [
    {
      id: 'notification-1',
      eventType: 'due_soon',
      recipientType: 'group',
      recipientId: 'group-product',
      payload: {},
      status: 'pending',
      createdAt: '2026-06-25T02:45:00Z',
    },
  ],
}

const candidate = {
  id: 'candidate-1',
  humanTaskId: task.id,
  originalVersionId: 'artifact-v1',
  modifiedVersionId: 'artifact-v2',
  originalContent: detail.artifact.content,
  modifiedContent: '这是人工修订后的业务结论。',
  unifiedDiff: '-原始业务结论\n+人工修订后的业务结论',
  reason: '补充关键证据',
  tags: ['人工修订'],
  workflowRunId: task.workflowRunId,
  workflowId: 'workflow-1',
  agentId: 'agent-1',
  sourceNodeId: 'agent-1',
  createdBy: 'reviewer-1',
  status: '待确认',
  createdAt: '2026-06-25T02:00:00Z',
  confirmedAt: null,
}

const detailWithMojibakeSla = {
  ...detail,
  ...mojibakeSlaTask,
  artifact: {
    id: 'artifact-mojibake-v1',
    version: 1,
    content: '这是包含历史 SLA 乱码状态的任务。',
    createdBy: 'system',
    createdAt: '2026-06-25T01:45:00Z',
  },
}

const detailFromLink = {
  ...detail,
  ...taskFromLink,
  artifact: {
    id: 'artifact-link-v1',
    version: 1,
    content: '这是从观测中心 taskId 深链进入的任务。',
    createdBy: 'system',
    createdAt: '2026-06-25T01:30:00Z',
  },
}

const completedRun = {
  id: 'run-completed-1',
  kind: 'workflow',
  name: '新品研究流程',
  workflowId: 'workflow-1',
  workflowVersion: 'v1.0.0',
  agentId: null,
  agentVersion: null,
  status: '已完成',
  input: '测试',
  output: '流程已结束，没有进入人工审核。',
  score: 86,
  model: '',
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  costUsd: 0,
  durationMs: 10,
  currentNode: '流程完成',
  error: '',
  startedAt: '2026-06-25T02:00:00Z',
  completedAt: '2026-06-25T02:00:10Z',
  nodes: [],
}

function currentSearchParams() {
  return new URLSearchParams(screen.getByLabelText('current search').textContent ?? '')
}

function response(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), { status }))
}

function baseFetch(url: string, init?: RequestInit) {
  if (url === `/api/workspaces/${workspace.id}/human-tasks` && !init?.method) {
    return response([task, taskFromLink])
  }
  if (url === `/api/workspaces/${workspace.id}/human-tasks/task-1` && !init?.method) {
    return response(detail)
  }
  if (url === `/api/workspaces/${workspace.id}/human-tasks/task-from-link` && !init?.method) {
    return response(detailFromLink)
  }
  if (url === `/api/workspaces/${workspace.id}/reviewers` && !init?.method) return response(reviewers)
  if (url === `/api/workspaces/${workspace.id}/review-groups` && !init?.method) return response(groups)
  if (url === `/api/workspaces/${workspace.id}/feedback-candidates` && !init?.method) return response([])
  if (url === `/api/workspaces/${workspace.id}/runs` && !init?.method) return response([completedRun])
  return response({ detail: 'Not Found' }, 404)
}

function emptyFetch(url: string, init?: RequestInit) {
  if (url === `/api/workspaces/${workspace.id}/human-tasks` && !init?.method) return response([])
  if (url === `/api/workspaces/${workspace.id}/reviewers` && !init?.method) return response(reviewers)
  if (url === `/api/workspaces/${workspace.id}/review-groups` && !init?.method) return response(groups)
  if (url === `/api/workspaces/${workspace.id}/feedback-candidates` && !init?.method) return response([])
  if (url === `/api/workspaces/${workspace.id}/runs` && !init?.method) return response([completedRun])
  return response({ detail: 'Not Found' }, 404)
}

function mojibakeSlaFetch(url: string, init?: RequestInit) {
  if (url === `/api/workspaces/${workspace.id}/human-tasks` && !init?.method) return response([mojibakeSlaTask])
  if (url === `/api/workspaces/${workspace.id}/human-tasks/task-mojibake-sla` && !init?.method) {
    return response(detailWithMojibakeSla)
  }
  if (url === `/api/workspaces/${workspace.id}/reviewers` && !init?.method) return response(reviewers)
  if (url === `/api/workspaces/${workspace.id}/review-groups` && !init?.method) return response(groups)
  if (url === `/api/workspaces/${workspace.id}/feedback-candidates` && !init?.method) return response([])
  if (url === `/api/workspaces/${workspace.id}/runs` && !init?.method) return response([completedRun])
  return response({ detail: 'Not Found' }, 404)
}

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="current search">{location.search}</output>
}

function renderReviews(userId = 'user-reviewer-1', initialPath = '/w/ai-capability-center/reviews') {
  const authValue: AuthContextValue = {
    user: {
      id: userId,
      email: `${userId}@example.com`,
      displayName: userId === 'user-reviewer-2' ? '陈卓' : '林晓',
      isOrganizationAdmin: false,
    },
    workspaces: [workspace],
    status: 'authenticated',
    login: vi.fn(),
    logout: vi.fn(),
    refreshSession: vi.fn(),
  }
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthContext.Provider value={authValue}>
        <WorkspaceProvider workspace={workspace}>
          <Reviews />
          <LocationProbe />
        </WorkspaceProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

describe('Reviews', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders queue artifact and review context in three panes', async () => {
    vi.stubGlobal('fetch', vi.fn(baseFetch))

    renderReviews()

    expect(await screen.findByText('新品定义人工审核')).toBeInTheDocument()
    expect(await screen.findByText(detail.artifact.content)).toBeInTheDocument()
    expect(screen.getByText(/新品研究流程/)).toBeInTheDocument()
    expect(screen.getAllByText('即将到期').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    expect(screen.getByText('task_created')).toBeInTheDocument()
    expect(screen.getByText('due_soon')).toBeInTheDocument()
    expect(screen.getByText('当前用户')).toBeInTheDocument()
    expect(screen.getByText('林晓 · 产品审核人')).toBeInTheDocument()
    expect(screen.queryByLabelText('当前操作者')).not.toBeInTheDocument()
  })

  it('selects the human task from the taskId query parameter', async () => {
    vi.stubGlobal('fetch', vi.fn(baseFetch))

    renderReviews('user-reviewer-1', '/w/ai-capability-center/reviews?taskId=task-from-link')

    expect(await screen.findByText(detailFromLink.artifact.content)).toBeInTheDocument()
    expect(screen.getByText('从 SLA 风险进入的任务')).toBeInTheDocument()
  })

  it('syncs the selected human task to the URL while preserving existing query params', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(baseFetch))

    renderReviews('user-reviewer-1', '/w/ai-capability-center/reviews?pane=queue')

    expect(await screen.findByText(detail.artifact.content)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /从 SLA 风险进入的任务/ }))

    await waitFor(() => {
      expect(screen.getByLabelText('current search')).toHaveTextContent('?pane=queue&taskId=task-from-link')
    })
    expect(await screen.findByText(detailFromLink.artifact.content)).toBeInTheDocument()
  })

  it('syncs review queue filters to the URL while preserving the selected task', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(baseFetch))

    renderReviews(
      'user-reviewer-1',
      '/w/ai-capability-center/reviews?taskId=task-1&source=sla&taskStatus=待认领&slaStatus=即将到期',
    )

    expect(await screen.findByText(detail.artifact.content)).toBeInTheDocument()
    expect(screen.getByLabelText('任务状态筛选')).toHaveValue('待认领')
    expect(screen.getByLabelText('SLA 筛选')).toHaveValue('即将到期')

    await user.selectOptions(screen.getByLabelText('SLA 筛选'), '全部')

    await waitFor(() => {
      expect(currentSearchParams().get('slaStatus')).toBeNull()
    })
    expect(currentSearchParams().get('taskId')).toBe('task-1')
    expect(currentSearchParams().get('source')).toBe('sla')
    expect(currentSearchParams().get('taskStatus')).toBe('待认领')

    await user.selectOptions(screen.getByLabelText('任务状态筛选'), '已通过')

    await waitFor(() => {
      expect(currentSearchParams().get('taskStatus')).toBe('已通过')
    })
    expect(currentSearchParams().get('taskId')).toBe('task-1')
    expect(currentSearchParams().get('source')).toBe('sla')
    expect(currentSearchParams().get('slaStatus')).toBeNull()
    expect(screen.getByText('当前筛选无任务')).toBeInTheDocument()
  })

  it('explains URL-provided review context and clears context filters', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(baseFetch))

    renderReviews(
      'user-reviewer-1',
      '/w/ai-capability-center/reviews?taskId=task-1&source=sla&taskStatus=待认领&slaStatus=即将到期',
    )

    const context = await screen.findByLabelText('当前审核上下文')
    expect(within(context).getByText('来自 SLA 风险入口')).toBeInTheDocument()
    expect(within(context).getByText('任务 task-1')).toBeInTheDocument()
    expect(within(context).getByText('状态 待认领')).toBeInTheDocument()
    expect(within(context).getByText('SLA 即将到期')).toBeInTheDocument()

    await user.click(within(context).getByRole('button', { name: '清空上下文筛选' }))

    await waitFor(() => {
      expect(currentSearchParams().get('taskStatus')).toBeNull()
      expect(currentSearchParams().get('slaStatus')).toBeNull()
    })
    expect(currentSearchParams().get('taskId')).toBe('task-1')
    expect(currentSearchParams().get('source')).toBe('sla')
    expect(screen.getByLabelText('任务状态筛选')).toHaveValue('全部')
    expect(screen.getByLabelText('SLA 筛选')).toHaveValue('全部')
  })

  it('copies the current review context link from the URL context panel', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    vi.stubGlobal('fetch', vi.fn(baseFetch))

    renderReviews(
      'user-reviewer-1',
      '/w/ai-capability-center/reviews?taskId=task-1&source=sla&taskStatus=待认领&slaStatus=即将到期',
    )

    const context = await screen.findByLabelText('当前审核上下文')

    await user.click(within(context).getByRole('button', { name: '复制当前链接' }))

    const copiedUrl = new URL(writeText.mock.calls[0]?.[0] as string)
    expect(copiedUrl.origin).toBe(window.location.origin)
    expect(copiedUrl.pathname).toBe('/w/ai-capability-center/reviews')
    expect(copiedUrl.searchParams.get('taskId')).toBe('task-1')
    expect(copiedUrl.searchParams.get('source')).toBe('sla')
    expect(copiedUrl.searchParams.get('taskStatus')).toBe('待认领')
    expect(copiedUrl.searchParams.get('slaStatus')).toBe('即将到期')
    expect(within(context).getByText('已复制当前审核链接')).toBeInTheDocument()
  })

  it('shows an error when copying the review context link fails', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard unavailable'))
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    vi.stubGlobal('fetch', vi.fn(baseFetch))

    renderReviews('user-reviewer-1', '/w/ai-capability-center/reviews?source=sla')

    const context = await screen.findByLabelText('当前审核上下文')

    await user.click(within(context).getByRole('button', { name: '复制当前链接' }))

    const copiedUrl = new URL(writeText.mock.calls[0]?.[0] as string)
    expect(copiedUrl.origin).toBe(window.location.origin)
    expect(copiedUrl.pathname).toBe('/w/ai-capability-center/reviews')
    expect(copiedUrl.searchParams.get('source')).toBe('sla')
    expect(copiedUrl.searchParams.get('taskId')).toBe('task-1')
    expect(within(context).getByText('复制失败，请手动复制地址栏链接')).toBeInTheDocument()
  })

  it('normalizes legacy mojibake SLA statuses in the queue and detail pane', async () => {
    vi.stubGlobal('fetch', vi.fn(mojibakeSlaFetch))

    renderReviews()

    expect(await screen.findByText('历史 SLA 状态任务')).toBeInTheDocument()
    expect(screen.getAllByText('已逾期').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText('宸查€炬湡')).not.toBeInTheDocument()
  })

  it('shows a guided empty state when the workspace has no human tasks', async () => {
    vi.stubGlobal('fetch', vi.fn(emptyFetch))

    renderReviews()

    expect(await screen.findByRole('heading', { name: '暂无人工任务' })).toBeInTheDocument()
    expect(screen.getByText('工作流运行到人工审核节点后，任务会自动进入这里。')).toBeInTheDocument()
    expect(screen.getByText('在工作流编排中加入人工审核节点并发布版本')).toBeInTheDocument()
    expect(screen.getByText('运行已发布工作流，等待状态进入需介入')).toBeInTheDocument()
    expect(screen.getByText('回到人工审核页认领任务并提交决定')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '去工作流编排' })).toHaveAttribute(
      'href',
      '/w/ai-capability-center/workflows',
    )
    expect(screen.getByRole('link', { name: '查看成员与权限' })).toHaveAttribute(
      'href',
      '/w/ai-capability-center/settings/members',
    )
  })

  it('diagnoses why the review queue is empty', async () => {
    vi.stubGlobal('fetch', vi.fn(emptyFetch))

    renderReviews('user-without-reviewer')

    const diagnostics = within(await screen.findByLabelText('人工审核验收诊断'))
    expect(diagnostics.getByText('当前账号')).toBeInTheDocument()
    expect(diagnostics.getByText('林晓')).toBeInTheDocument()
    expect(diagnostics.getByText('Reviewer 资格')).toBeInTheDocument()
    expect(diagnostics.getByText('未获得')).toBeInTheDocument()
    expect(diagnostics.getByText('人工任务数量')).toBeInTheDocument()
    expect(diagnostics.getByText('0')).toBeInTheDocument()
    expect(diagnostics.getByText('最近运行状态')).toBeInTheDocument()
    expect(diagnostics.getByText('已完成')).toBeInTheDocument()
    expect(diagnostics.getByText('下一步建议')).toBeInTheDocument()
    expect(diagnostics.getByText('先在成员与权限中绑定 Reviewer 资格，再运行包含人工审核节点的工作流。')).toBeInTheDocument()
  })

  it('shows review workload metrics and filtered empty guidance', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(baseFetch))

    renderReviews()

    expect(await screen.findByText('待处理任务')).toBeInTheDocument()
    expect(screen.getByText('SLA 风险')).toBeInTheDocument()
    expect(screen.getByText('待确认反馈')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('任务状态筛选'), '已通过')

    expect(screen.getByText('当前筛选无任务')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '清空筛选' }))
    expect(screen.getByText('新品定义人工审核')).toBeInTheDocument()
  })

  it('refreshes reviewer identity when qualifications change', async () => {
    let reviewerCallCount = 0
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === `/api/workspaces/${workspace.id}/reviewers` && !init?.method) {
        reviewerCallCount += 1
        return response(reviewerCallCount === 1
          ? reviewers
          : reviewers.map((reviewer) => (
            reviewer.id === 'reviewer-1' ? { ...reviewer, isActive: false } : reviewer
          )))
      }
      return baseFetch(url, init)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderReviews()

    expect(await screen.findByText('林晓 · 产品审核人')).toBeInTheDocument()

    window.dispatchEvent(new Event('reviewer-qualifications-updated'))

    await waitFor(() => {
      expect(screen.getByText('未获得 Reviewer 资格')).toBeInTheDocument()
    })
    expect(reviewerCallCount).toBeGreaterThanOrEqual(2)
  })

  it('validates and submits modification with the current artifact version', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === `/api/workspaces/${workspace.id}/human-tasks/task-1/decisions` && init?.method === 'POST') {
        return response({
          ...detail,
          status: '修改后通过',
          artifact: {
            ...detail.artifact,
            id: 'artifact-v2',
            version: 2,
            content: '这是人工修订后的正式业务结论。',
          },
        })
      }
      return baseFetch(url, init)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderReviews()

    await screen.findByText(detail.artifact.content)
    await user.click(screen.getByRole('button', { name: '编辑产出物' }))
    const editor = screen.getByLabelText('修订后的产出物')
    await user.clear(editor)
    await user.type(editor, '这是人工修订后的正式业务结论。')
    await user.click(screen.getByRole('button', { name: '修改后通过' }))
    expect(await screen.findByText('请填写审核原因')).toBeInTheDocument()

    await user.type(screen.getByLabelText('审核原因'), '补充证据并统一表述')
    await user.click(screen.getByRole('button', { name: '修改后通过' }))

    expect(await screen.findByText('审核决定已提交')).toBeInTheDocument()
    const decisionCall = fetchMock.mock.calls.find(([url]) => (
      url === `/api/workspaces/${workspace.id}/human-tasks/task-1/decisions`
    ))
    const body = JSON.parse(decisionCall?.[1]?.body as string)
    expect(body).toEqual(expect.objectContaining({
      decision: 'modify_and_approve',
      reason: '补充证据并统一表述',
      artifactVersionId: 'artifact-v1',
      modifiedContent: '这是人工修订后的正式业务结论。',
    }))
    expect(body).not.toHaveProperty('reviewerId')
  })

  it('claims transfers and lets an expert confirm a golden sample', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === `/api/workspaces/${workspace.id}/feedback-candidates`) return response([candidate])
      if (url === `/api/workspaces/${workspace.id}/human-tasks/task-1/claim` && init?.method === 'POST') {
        return response({ ...task, status: '审核中', assigneeReviewerId: 'reviewer-2' })
      }
      if (url === `/api/workspaces/${workspace.id}/human-tasks/task-1/transfer` && init?.method === 'POST') {
        return response({ ...task, status: '审核中', assigneeReviewerId: 'reviewer-1' })
      }
      if (url === `/api/workspaces/${workspace.id}/feedback-candidates/candidate-1/confirm` && init?.method === 'POST') {
        return response({
          id: 'golden-1',
          candidateId: candidate.id,
          input: '生成新品定义',
          expectedOutput: candidate.modifiedContent,
          reviewerId: 'reviewer-2',
          reason: '符合黄金样本标准',
          createdAt: '2026-06-25T03:00:00Z',
        }, 201)
      }
      return baseFetch(url, init)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderReviews('user-reviewer-2')

    await screen.findByText('新品定义人工审核')
    await screen.findByText(detail.artifact.content)
    await user.click(screen.getByRole('button', { name: '认领任务' }))
    expect(await screen.findByText('任务已认领')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '认领任务' })).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('转交审核人'), 'reviewer-1')
    await user.type(screen.getByLabelText('转交原因'), '需要质量专家处理')
    await user.click(screen.getByRole('button', { name: '确认转交' }))
    expect(await screen.findByText('任务已转交')).toBeInTheDocument()

    await user.type(screen.getByLabelText('专家确认理由'), '符合黄金样本标准')
    await user.click(screen.getByRole('button', { name: '确认黄金样本' }))
    expect(await screen.findByText('黄金样本已创建')).toBeInTheDocument()
    const claimCall = fetchMock.mock.calls.find(([url]) => (
      url === `/api/workspaces/${workspace.id}/human-tasks/task-1/claim`
    ))
    expect(claimCall?.[1]?.body).toBeUndefined()
    const transferCall = fetchMock.mock.calls.find(([url]) => (
      url === `/api/workspaces/${workspace.id}/human-tasks/task-1/transfer`
    ))
    const transferBody = JSON.parse(transferCall?.[1]?.body as string)
    expect(transferBody).toEqual(expect.objectContaining({
      targetReviewerId: 'reviewer-1',
      reason: '需要质量专家处理',
    }))
    expect(transferBody).not.toHaveProperty('reviewerId')
    expect(transferBody).not.toHaveProperty('actorId')
    const confirmCall = fetchMock.mock.calls.find(([url]) => (
      url === `/api/workspaces/${workspace.id}/feedback-candidates/candidate-1/confirm`
    ))
    expect(JSON.parse(confirmCall?.[1]?.body as string)).not.toHaveProperty('reviewerId')
  })

  it('disables review commands when the logged in user has no reviewer qualification', async () => {
    vi.stubGlobal('fetch', vi.fn(baseFetch))

    renderReviews('user-without-reviewer')

    await screen.findByText(detail.artifact.content)
    expect(screen.getByText('当前用户')).toBeInTheDocument()
    expect(screen.getByText('未获得 Reviewer 资格')).toBeInTheDocument()
    expect(screen.getByText('当前任务权限')).toBeInTheDocument()
    expect(screen.getByText('当前账号未绑定 Reviewer 资格，所以不能认领任务或提交审核决定。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '认领任务' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '通过' })).toBeDisabled()
  })

  it('explains and disables actions when the reviewer is outside the task participant scope', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === `/api/workspaces/${workspace.id}/reviewers` && !init?.method) {
        return response([
          ...reviewers,
          { id: 'reviewer-outside', userId: 'user-reviewer-outside', name: '管理员', role: '产品审核人', isExpert: false, isActive: true },
        ])
      }
      return baseFetch(url, init)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderReviews('user-reviewer-outside')

    await screen.findByText(detail.artifact.content)
    expect(screen.getByText('当前任务权限')).toBeInTheDocument()
    expect(screen.getByText('不能处理')).toBeInTheDocument()
    expect(screen.getByText('把当前账号加入该 Human 节点的审核人或审核组后，再回到这里处理。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '认领任务' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '通过' })).toBeDisabled()
  })

  it('switches mobile panes with an accessible segmented state', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(baseFetch))

    renderReviews()

    await screen.findByText(detail.artifact.content)
    const queueTab = screen.getByRole('button', { name: '队列' })
    const reviewTab = screen.getByRole('button', { name: '审核' })
    const contextTab = screen.getByRole('button', { name: '上下文' })
    expect(queueTab).toHaveAttribute('aria-pressed', 'true')

    await user.click(reviewTab)
    expect(reviewTab).toHaveAttribute('aria-pressed', 'true')
    expect(queueTab).toHaveAttribute('aria-pressed', 'false')

    await user.click(contextTab)
    expect(contextTab).toHaveAttribute('aria-pressed', 'true')
    expect(reviewTab).toHaveAttribute('aria-pressed', 'false')
  })
})
