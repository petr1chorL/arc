import { render, screen, within } from '@testing-library/react'
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
      if (input === `/api/workspaces/${workspace.id}/evaluations/records`) {
        return response([])
      }
      return response({ detail: 'not found' }, 404)
    }))

    renderPage()

    expect(await screen.findByText('Golden Sample')).toBeInTheDocument()
    expect(await screen.findByText('专家修改为更可靠的输出')).toBeInTheDocument()
    expect(screen.getByText('accuracy')).toBeInTheDocument()
    expect(screen.getByText('evidence')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'API 持久化 Rubric' })).toBeInTheDocument()
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
      if (input === `/api/workspaces/${workspace.id}/evaluations/records`) {
        return response([])
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

    expect(await screen.findByRole('heading', { name: '新品机会评分' })).toBeInTheDocument()
    expect(screen.getByText((_, element) => (
      element?.textContent === '适用产出物：机会评估表'
    ))).toBeInTheDocument()
  })

  it('runs a rubric evaluation from the configuration dialog', async () => {
    const user = userEvent.setup()
    const evaluationRecord = {
      id: 'evaluation-1',
      rubricId: rubricAssets[0].id,
      rubricVersion: 'v1.0',
      rubricSnapshot: rubricAssets[0],
      subjectType: 'manual_artifact',
      subjectId: null,
      artifactText: 'This artifact includes source evidence, tradeoffs, and next actions.',
      dimensionScores: [
        { name: 'Accuracy', weight: 60, score: 88 },
        { name: 'Completeness', weight: 40, score: 88 },
      ],
      score: 88,
      status: 'passed',
      rationale: 'deterministic rubric evaluation',
      createdAt: '2026-06-27T00:00:00Z',
    }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (input === `/api/workspaces/${workspace.id}/evaluations/overview`) {
        return response(overview)
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/rubrics`) {
        return response(rubricAssets)
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/records`) {
        return response([])
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/rubrics/${rubricAssets[0].id}/versions`) {
        return response([])
      }
      if (
        input === `/api/workspaces/${workspace.id}/evaluations/rubrics/${rubricAssets[0].id}/evaluate`
        && init?.method === 'POST'
      ) {
        return response(evaluationRecord, 201)
      }
      return response({ detail: 'not found' }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    await user.click(await screen.findByTitle('配置量规'))
    expect(await screen.findByRole('heading', { name: '运行评估' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('待评估产出物'), evaluationRecord.artifactText)
    await user.click(screen.getByRole('button', { name: '运行评估' }))

    const resultCard = (await screen.findByText('总分 88')).closest('.rubric-evaluation-result')
    expect(resultCard).not.toBeNull()
    expect(within(resultCard as HTMLElement).getByText('deterministic rubric evaluation')).toBeInTheDocument()
    expect(screen.getByText('evaluation-1')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/workspaces/${workspace.id}/evaluations/rubrics/${rubricAssets[0].id}/evaluate`,
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('shows evaluation records and filters them by status and rubric', async () => {
    const user = userEvent.setup()
    const records = [
      {
        id: 'evaluation-pass',
        rubricId: rubricAssets[0].id,
        rubricVersion: 'v1.0',
        rubricSnapshot: rubricAssets[0],
        subjectType: 'manual_artifact',
        subjectId: 'artifact-pass',
        artifactText: 'Passed artifact with evidence and next actions.',
        dimensionScores: [{ name: 'Accuracy', weight: 100, score: 91 }],
        score: 91,
        status: 'passed',
        rationale: 'deterministic rubric evaluation',
        createdAt: '2026-06-27T00:00:00Z',
      },
      {
        id: 'evaluation-fail',
        rubricId: 'rubric-other',
        rubricVersion: 'v1.0',
        rubricSnapshot: { ...rubricAssets[0], id: 'rubric-other', name: 'Other Rubric' },
        subjectType: 'manual_artifact',
        subjectId: 'artifact-fail',
        artifactText: 'Failed artifact.',
        dimensionScores: [{ name: 'Accuracy', weight: 100, score: 42 }],
        score: 42,
        status: 'failed',
        rationale: 'deterministic rubric evaluation',
        createdAt: '2026-06-27T00:05:00Z',
      },
    ]
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (input === `/api/workspaces/${workspace.id}/evaluations/overview`) {
        return response(overview)
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/rubrics`) {
        return response(rubricAssets)
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/records`) {
        return response(records)
      }
      return response({ detail: 'not found' }, 404)
    }))

    renderPage()

    expect(await screen.findByText('评估记录')).toBeInTheDocument()
    expect(screen.getByText('evaluation-pass')).toBeInTheDocument()
    expect(screen.getByText('evaluation-fail')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('状态筛选'), 'passed')
    expect(screen.getByText('evaluation-pass')).toBeInTheDocument()
    expect(screen.queryByText('evaluation-fail')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Rubric 筛选'), 'rubric-api-1')
    expect(screen.getByText('evaluation-pass')).toBeInTheDocument()
  })
})
