import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '../auth/WorkspaceContext'
import { Evaluations } from './Evaluations'

const workspace = {
  id: 'workspace-1',
  slug: 'ai-capability-center',
  name: 'AI 能力中心',
}

const overview = {
  totals: {
    feedbackCandidates: 3,
    pendingCandidates: 1,
    confirmedCandidates: 2,
    goldenSamples: 2,
    coveredWorkflows: 2,
    coveredAgents: 1,
  },
  recentCandidates: [{
    id: 'candidate-1',
    reason: '专家修改为更可靠的输出',
    tags: ['accuracy', 'evidence'],
    workflowId: 'workflow-1',
    agentId: 'agent-1',
    sourceNodeId: 'agent-node',
    createdBy: 'reviewer-1',
    status: '已确认',
    createdAt: '2026-06-26T09:00:00Z',
    confirmedAt: '2026-06-26T09:05:00Z',
  }],
}

const rubricAssets = [{
  id: 'rubric-api-1',
  name: 'API 持久化 Rubric',
  artifact: '真实接口产出物',
  dimensions: [
    { name: '准确性', weight: 60 },
    { name: '完整性', weight: 40 },
  ],
  gate: '必须绑定评估数据源',
  passScore: 86,
  version: 'v1.0',
  status: 'active',
}]

function response(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), { status }))
}

function renderPage() {
  return render(
    <MemoryRouter>
      <WorkspaceProvider workspace={workspace}>
        <Evaluations />
      </WorkspaceProvider>
    </MemoryRouter>,
  )
}

describe('Evaluations page', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders real feedback, golden sample overview data, and API rubric assets', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (input === `/api/workspaces/${workspace.id}/evaluations/overview`) {
        return response(overview)
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/rubrics`) {
        return response(rubricAssets)
      }
      return response({ detail: 'not found' }, 404)
    }))

    renderPage()

    expect(await screen.findByText('Golden Sample')).toBeInTheDocument()
    expect(await screen.findByText('专家修改为更可靠的输出')).toBeInTheDocument()
    expect(screen.getByText('accuracy')).toBeInTheDocument()
    expect(screen.getByText('evidence')).toBeInTheDocument()
    expect(await screen.findByText('API 持久化 Rubric')).toBeInTheDocument()
    expect(screen.getByText((_, element) => (
      element?.textContent === '适用产出物：真实接口产出物'
    ))).toBeInTheDocument()
  })

  it('creates a rubric from the evaluation center with client-side validation', async () => {
    const user = userEvent.setup()
    const createdRubric = {
      id: 'rubric-new',
      name: '新品机会评分',
      artifact: '机会评估表',
      dimensions: [
        { name: '用户价值', weight: 100 },
      ],
      gate: '必须有原始证据',
      passScore: 90,
      version: 'v0.1.0',
      status: 'draft',
    }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (input === `/api/workspaces/${workspace.id}/evaluations/overview`) {
        return response(overview)
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/rubrics` && init?.method === 'POST') {
        return response(createdRubric, 201)
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/rubrics`) {
        return response(rubricAssets)
      }
      return response({ detail: 'not found' }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    await user.click(await screen.findByRole('button', { name: '新建评分量规' }))
    await user.clear(screen.getByLabelText('名称'))
    await user.type(screen.getByLabelText('名称'), '新品机会评分')
    await user.clear(screen.getByLabelText('适用产出物'))
    await user.type(screen.getByLabelText('适用产出物'), '机会评估表')
    await user.clear(screen.getByLabelText('维度 1 名称'))
    await user.type(screen.getByLabelText('维度 1 名称'), '用户价值')
    await user.clear(screen.getByLabelText('维度 1 权重'))
    await user.type(screen.getByLabelText('维度 1 权重'), '80')
    await user.clear(screen.getByLabelText('硬性门禁'))
    await user.type(screen.getByLabelText('硬性门禁'), '必须有原始证据')
    await user.clear(screen.getByLabelText('通过分数'))
    await user.type(screen.getByLabelText('通过分数'), '90')
    await user.click(screen.getByRole('button', { name: '保存评分量规' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('维度权重合计必须等于 100')
    expect(fetchMock).not.toHaveBeenCalledWith(
      `/api/workspaces/${workspace.id}/evaluations/rubrics`,
      expect.objectContaining({ method: 'POST' }),
    )

    await user.clear(screen.getByLabelText('维度 1 权重'))
    await user.type(screen.getByLabelText('维度 1 权重'), '100')
    await user.click(screen.getByRole('button', { name: '保存评分量规' }))

    expect(await screen.findByText('新品机会评分')).toBeInTheDocument()
    expect(screen.getByText((_, element) => (
      element?.textContent === '适用产出物：机会评估表'
    ))).toBeInTheDocument()
  })
})
