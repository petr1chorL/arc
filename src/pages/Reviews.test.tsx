import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '../auth/WorkspaceContext'
import { Reviews } from './Reviews'

const workspace = {
  id: 'workspace-1',
  slug: 'ai-capability-center',
  name: 'AI 能力中心',
}

const reviewers = [
  { id: 'reviewer-1', name: '林晓', role: '产品审核人', isExpert: false, isActive: true },
  { id: 'reviewer-2', name: '陈卓', role: '质量专家', isExpert: true, isActive: true },
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

function response(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), { status }))
}

function baseFetch(url: string, init?: RequestInit) {
  if (url === `/api/workspaces/${workspace.id}/human-tasks` && !init?.method) {
    return response([task])
  }
  if (url === `/api/workspaces/${workspace.id}/human-tasks/task-1` && !init?.method) {
    return response(detail)
  }
  if (url === `/api/workspaces/${workspace.id}/reviewers` && !init?.method) return response(reviewers)
  if (url === `/api/workspaces/${workspace.id}/review-groups` && !init?.method) return response(groups)
  if (url === `/api/workspaces/${workspace.id}/feedback-candidates` && !init?.method) return response([])
  return response({ detail: 'Not Found' }, 404)
}

function renderReviews() {
  return render(
    <WorkspaceProvider workspace={workspace}>
      <Reviews />
    </WorkspaceProvider>,
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
    expect(JSON.parse(decisionCall?.[1]?.body as string)).toEqual(expect.objectContaining({
      reviewerId: 'reviewer-1',
      decision: 'modify_and_approve',
      reason: '补充证据并统一表述',
      artifactVersionId: 'artifact-v1',
      modifiedContent: '这是人工修订后的正式业务结论。',
    }))
  })

  it('claims transfers and lets an expert confirm a golden sample', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === `/api/workspaces/${workspace.id}/feedback-candidates`) return response([candidate])
      if (url === `/api/workspaces/${workspace.id}/human-tasks/task-1/claim` && init?.method === 'POST') {
        return response({ ...task, status: '审核中', assigneeReviewerId: 'reviewer-1' })
      }
      if (url === `/api/workspaces/${workspace.id}/human-tasks/task-1/transfer` && init?.method === 'POST') {
        return response({ ...task, status: '审核中', assigneeReviewerId: 'reviewer-2' })
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

    renderReviews()

    await screen.findByText('新品定义人工审核')
    await screen.findByText(detail.artifact.content)
    await user.click(screen.getByRole('button', { name: '认领任务' }))
    expect(await screen.findByText('任务已认领')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '认领任务' })).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('转交审核人'), 'reviewer-2')
    await user.type(screen.getByLabelText('转交原因'), '需要质量专家处理')
    await user.click(screen.getByRole('button', { name: '确认转交' }))
    expect(await screen.findByText('任务已转交')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('当前操作者'), 'reviewer-2')
    await user.type(screen.getByLabelText('专家确认理由'), '符合黄金样本标准')
    await user.click(screen.getByRole('button', { name: '确认黄金样本' }))
    expect(await screen.findByText('黄金样本已创建')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/workspaces/${workspace.id}/feedback-candidates/candidate-1/confirm`,
      expect.objectContaining({ method: 'POST' }),
    )
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
