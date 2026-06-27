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
      if (input === `/api/workspaces/${workspace.id}/evaluations/sample-sets`) {
        return response([])
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/sample-sets`) {
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
      if (input === `/api/workspaces/${workspace.id}/evaluations/sample-sets`) {
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
      if (input === `/api/workspaces/${workspace.id}/evaluations/sample-sets`) {
        return response([])
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
      if (input === `/api/workspaces/${workspace.id}/evaluations/sample-sets`) {
        return response([])
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

  it('runs a lightweight batch regression and shows pass rate and failed samples', async () => {
    const user = userEvent.setup()
    const batchResponses = [
      {
        id: 'batch-pass',
        rubricId: rubricAssets[0].id,
        rubricVersion: 'v1.0',
        rubricSnapshot: rubricAssets[0],
        subjectType: 'regression_sample',
        subjectId: 'sample-1',
        artifactText: 'sample with evidence and next action',
        dimensionScores: [{ name: 'Accuracy', weight: 100, score: 88 }],
        score: 88,
        status: 'passed',
        rationale: 'deterministic rubric evaluation',
        createdAt: '2026-06-27T00:00:00Z',
      },
      {
        id: 'batch-fail',
        rubricId: rubricAssets[0].id,
        rubricVersion: 'v1.0',
        rubricSnapshot: rubricAssets[0],
        subjectType: 'regression_sample',
        subjectId: 'sample-2',
        artifactText: 'thin sample',
        dimensionScores: [{ name: 'Accuracy', weight: 100, score: 42 }],
        score: 42,
        status: 'failed',
        rationale: 'missing evidence',
        createdAt: '2026-06-27T00:01:00Z',
      },
    ]
    const createdRun = {
      id: 'manual-run',
      sampleSetId: null,
      sampleSetName: '手动样本',
      rubricId: rubricAssets[0].id,
      rubricName: rubricAssets[0].name,
      rubricVersion: 'v1.0',
      status: 'completed',
      totalSamples: 2,
      passedSamples: 1,
      failedSamples: 1,
      passRate: 50,
      evaluationIds: batchResponses.map((record) => record.id),
      records: batchResponses,
      createdBy: 'user-1',
      createdAt: '2026-06-27T00:00:00Z',
      completedAt: '2026-06-27T00:00:00Z',
    }
    const evaluatedBodies: unknown[] = []
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
      if (
        input === `/api/workspaces/${workspace.id}/evaluations/regression-runs`
        && init?.method === 'POST'
      ) {
        evaluatedBodies.push(JSON.parse(String(init.body)))
        return response(createdRun, 201)
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/regression-runs`) {
        return response([])
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/sample-sets`) {
        return response([])
      }
      return response({ detail: 'not found' }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    expect(await screen.findByText('批量回归')).toBeInTheDocument()
    await user.type(screen.getByLabelText('回归样本'), 'sample with evidence and next action\nthin sample')
    await user.click(screen.getByTestId('run-batch-regression'))

    expect((await screen.findAllByText('通过率 50%')).length).toBeGreaterThan(0)
    expect(screen.getByText('2 条样本')).toBeInTheDocument()
    expect(screen.getByText('1 条失败')).toBeInTheDocument()
    expect(screen.getByText('thin sample')).toBeInTheDocument()
    expect(screen.getAllByText('batch-fail')).toHaveLength(2)
    expect(evaluatedBodies).toEqual([
      {
        rubricId: rubricAssets[0].id,
        samples: [
          {
            input: 'sample with evidence and next action',
            sampleId: 'sample-1',
          },
          {
            input: 'thin sample',
            sampleId: 'sample-2',
          },
        ],
      },
    ])
  })

  it('runs batch regression from a saved Golden Set', async () => {
    const user = userEvent.setup()
    const sampleSets = [{
      id: 'sample-set-1',
      name: 'Launch Golden Set',
      description: 'Reusable launch samples',
      status: 'active',
      sampleCount: 2,
      activeSampleCount: 2,
      createdBy: 'user-1',
      createdAt: '2026-06-27T00:00:00Z',
      updatedAt: '2026-06-27T00:00:00Z',
      samples: [
        {
          id: 'sample-a',
          sampleSetId: 'sample-set-1',
          name: 'Evidence rich',
          input: 'sample with evidence and next action',
          expectedOutput: 'score should pass',
          tags: ['launch'],
          sourceType: 'manual',
          sourceId: null,
          status: 'active',
          createdBy: 'user-1',
          createdAt: '2026-06-27T00:00:00Z',
          updatedAt: '2026-06-27T00:00:00Z',
        },
        {
          id: 'sample-b',
          sampleSetId: 'sample-set-1',
          name: 'Thin sample',
          input: 'thin sample',
          expectedOutput: 'score should fail',
          tags: ['risk'],
          sourceType: 'manual',
          sourceId: null,
          status: 'active',
          createdBy: 'user-1',
          createdAt: '2026-06-27T00:00:00Z',
          updatedAt: '2026-06-27T00:00:00Z',
        },
      ],
    }]
    const batchResponses = sampleSets[0].samples.map((sample, index) => ({
      id: `golden-batch-${index + 1}`,
      rubricId: rubricAssets[0].id,
      rubricVersion: 'v1.0',
      rubricSnapshot: rubricAssets[0],
      subjectType: 'regression_run_sample',
      subjectId: sample.id,
      artifactText: sample.input,
      dimensionScores: [{ name: 'Accuracy', weight: 100, score: index === 0 ? 88 : 42 }],
      score: index === 0 ? 88 : 42,
      status: index === 0 ? 'passed' : 'failed',
      rationale: 'deterministic rubric evaluation',
      createdAt: '2026-06-27T00:00:00Z',
    }))
    const createdRun = {
      id: 'golden-run',
      sampleSetId: 'sample-set-1',
      sampleSetName: 'Launch Golden Set',
      rubricId: rubricAssets[0].id,
      rubricName: rubricAssets[0].name,
      rubricVersion: 'v1.0',
      status: 'completed',
      totalSamples: 2,
      passedSamples: 1,
      failedSamples: 1,
      passRate: 50,
      evaluationIds: batchResponses.map((record) => record.id),
      records: batchResponses,
      createdBy: 'user-1',
      createdAt: '2026-06-27T00:00:00Z',
      completedAt: '2026-06-27T00:00:00Z',
    }
    const evaluatedBodies: unknown[] = []
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
      if (input === `/api/workspaces/${workspace.id}/evaluations/sample-sets`) {
        return response(sampleSets)
      }
      if (
        input === `/api/workspaces/${workspace.id}/evaluations/regression-runs`
        && init?.method === 'POST'
      ) {
        evaluatedBodies.push(JSON.parse(String(init.body)))
        return response(createdRun, 201)
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/regression-runs`) {
        return response([])
      }
      return response({ detail: 'not found' }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    expect(await screen.findByText('Regression Sample Sets')).toBeInTheDocument()
    expect(screen.getAllByText('Launch Golden Set').length).toBeGreaterThan(0)
    await user.selectOptions(screen.getByLabelText('Golden Set'), 'sample-set-1')
    await user.click(screen.getByTestId('run-batch-regression'))

    expect(await screen.findByText('sample-b')).toBeInTheDocument()
    expect(evaluatedBodies).toEqual([
      {
        rubricId: rubricAssets[0].id,
        sampleSetId: 'sample-set-1',
      },
    ])
  })

  it('opens an evaluation record detail dialog with artifact text and rubric snapshot', async () => {
    const user = userEvent.setup()
    const records = [{
      id: 'evaluation-detail',
      rubricId: rubricAssets[0].id,
      rubricVersion: 'v1.0',
      rubricSnapshot: rubricAssets[0],
      subjectType: 'manual_artifact',
      subjectId: 'artifact-detail',
      artifactText: 'Detailed artifact text with evidence, tradeoffs, and next action.',
      dimensionScores: [{ name: 'Accuracy', weight: 100, score: 91 }],
      score: 91,
      status: 'passed',
      rationale: 'deterministic rubric evaluation',
      createdAt: '2026-06-27T00:00:00Z',
    }]
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
      if (input === `/api/workspaces/${workspace.id}/evaluations/sample-sets`) {
        return response([])
      }
      return response({ detail: 'not found' }, 404)
    }))

    renderPage()

    await user.click(await screen.findByRole('button', { name: '查看详情' }))

    const dialog = await screen.findByRole('dialog', { name: '评估详情' })
    expect(within(dialog).getByText('evaluation-detail')).toBeInTheDocument()
    expect(within(dialog).getByText('Detailed artifact text with evidence, tradeoffs, and next action.')).toBeInTheDocument()
    expect(within(dialog).getByText('Rubric 快照')).toBeInTheDocument()
    expect(within(dialog).getByText('必须绑定评估数据源')).toBeInTheDocument()
    expect(within(dialog).getByText('Accuracy')).toBeInTheDocument()
    expect(within(dialog).getByText('权重 100%')).toBeInTheDocument()
    expect(within(dialog).getByText('得分 91')).toBeInTheDocument()
  })

  it('runs a persisted batch regression and prepends the Regression Run history', async () => {
    const user = userEvent.setup()
    const sampleSets = [{
      id: 'sample-set-1',
      name: 'Launch Golden Set',
      description: 'Reusable launch samples',
      status: 'active',
      sampleCount: 2,
      activeSampleCount: 2,
      createdBy: 'user-1',
      createdAt: '2026-06-27T00:00:00Z',
      updatedAt: '2026-06-27T00:00:00Z',
      samples: [
        {
          id: 'sample-a',
          sampleSetId: 'sample-set-1',
          name: 'Evidence rich',
          input: 'sample with evidence and next action',
          expectedOutput: 'score should pass',
          tags: ['launch'],
          sourceType: 'manual',
          sourceId: null,
          status: 'active',
          createdBy: 'user-1',
          createdAt: '2026-06-27T00:00:00Z',
          updatedAt: '2026-06-27T00:00:00Z',
        },
        {
          id: 'sample-b',
          sampleSetId: 'sample-set-1',
          name: 'Thin sample',
          input: 'thin sample',
          expectedOutput: 'score should fail',
          tags: ['risk'],
          sourceType: 'manual',
          sourceId: null,
          status: 'active',
          createdBy: 'user-1',
          createdAt: '2026-06-27T00:00:00Z',
          updatedAt: '2026-06-27T00:00:00Z',
        },
      ],
    }]
    const runRecords = sampleSets[0].samples.map((sample, index) => ({
      id: index === 0 ? 'eval-pass' : 'eval-fail',
      rubricId: rubricAssets[0].id,
      rubricVersion: 'v1.0',
      rubricSnapshot: rubricAssets[0],
      subjectType: 'regression_run_sample',
      subjectId: sample.id,
      artifactText: sample.input,
      dimensionScores: [{ name: 'Accuracy', weight: 100, score: index === 0 ? 88 : 42 }],
      score: index === 0 ? 88 : 42,
      status: index === 0 ? 'passed' : 'failed',
      rationale: 'deterministic rubric evaluation',
      createdAt: '2026-06-27T00:05:00Z',
    }))
    const existingRuns = [{
      id: 'run-old',
      sampleSetId: 'sample-set-old',
      sampleSetName: 'Older Golden Set',
      rubricId: rubricAssets[0].id,
      rubricName: rubricAssets[0].name,
      rubricVersion: 'v1.0',
      status: 'completed',
      totalSamples: 3,
      passedSamples: 2,
      failedSamples: 1,
      passRate: 67,
      evaluationIds: ['old-1', 'old-2', 'old-3'],
      records: [],
      createdBy: 'user-1',
      createdAt: '2026-06-27T00:00:00Z',
      completedAt: '2026-06-27T00:00:00Z',
    }]
    const createdRun = {
      id: 'run-new',
      sampleSetId: 'sample-set-1',
      sampleSetName: 'Launch Golden Set',
      rubricId: rubricAssets[0].id,
      rubricName: rubricAssets[0].name,
      rubricVersion: 'v1.0',
      status: 'completed',
      totalSamples: 2,
      passedSamples: 1,
      failedSamples: 1,
      passRate: 50,
      evaluationIds: ['eval-pass', 'eval-fail'],
      records: runRecords,
      createdBy: 'user-1',
      createdAt: '2026-06-27T00:05:00Z',
      completedAt: '2026-06-27T00:05:00Z',
    }
    const runBodies: unknown[] = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (input === `/api/workspaces/${workspace.id}/evaluations/overview`) {
        return response(overview)
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/rubrics`) {
        return response(rubricAssets)
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/records`) {
        return response([])
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/sample-sets`) {
        return response(sampleSets)
      }
      if (
        input === `/api/workspaces/${workspace.id}/evaluations/regression-runs`
        && init?.method === 'POST'
      ) {
        runBodies.push(JSON.parse(String(init.body)))
        return response(createdRun, 201)
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/regression-runs`) {
        return response(existingRuns)
      }
      return response({ detail: 'not found' }, 404)
    }))

    renderPage()

    expect(await screen.findByText('Regression Run History')).toBeInTheDocument()
    expect(screen.getByText('run-old')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Golden Set'), 'sample-set-1')
    await user.click(screen.getByTestId('run-batch-regression'))

    expect(await screen.findByText('run-new')).toBeInTheDocument()
    expect(screen.getAllByText('Launch Golden Set').length).toBeGreaterThan(0)
    expect(screen.getAllByText((_, element) => element?.textContent === '通过率 50%').length).toBeGreaterThan(0)
    expect(runBodies).toEqual([{ rubricId: rubricAssets[0].id, sampleSetId: 'sample-set-1' }])
  })

  it('filters Regression Run history and opens a detail dialog', async () => {
    const user = userEvent.setup()
    const otherRubric = {
      ...rubricAssets[0],
      id: 'rubric-other',
      name: 'Other Rubric',
    }
    const runs = [
      {
        id: 'run-keep',
        sampleSetId: 'sample-set-1',
        sampleSetName: 'Launch Golden Set',
        rubricId: rubricAssets[0].id,
        rubricName: rubricAssets[0].name,
        rubricVersion: 'v1.0',
        status: 'completed',
        totalSamples: 2,
        passedSamples: 1,
        failedSamples: 1,
        passRate: 50,
        evaluationIds: ['eval-pass', 'eval-fail'],
        records: [],
        createdBy: 'user-1',
        createdAt: '2026-06-27T00:05:00Z',
        completedAt: '2026-06-27T00:05:00Z',
      },
      {
        id: 'run-hidden',
        sampleSetId: null,
        sampleSetName: '手动样本',
        rubricId: otherRubric.id,
        rubricName: otherRubric.name,
        rubricVersion: 'v1.0',
        status: 'failed',
        totalSamples: 1,
        passedSamples: 0,
        failedSamples: 1,
        passRate: 0,
        evaluationIds: ['eval-hidden'],
        records: [],
        createdBy: 'user-1',
        createdAt: '2026-06-27T00:00:00Z',
        completedAt: '2026-06-27T00:00:00Z',
      },
    ]
    const detailRun = {
      ...runs[0],
      records: [
        {
          id: 'eval-pass',
          rubricId: rubricAssets[0].id,
          rubricVersion: 'v1.0',
          rubricSnapshot: rubricAssets[0],
          subjectType: 'regression_run_sample',
          subjectId: 'sample-a',
          artifactText: 'sample with evidence and next action',
          dimensionScores: [{ name: 'Accuracy', weight: 100, score: 88 }],
          score: 88,
          status: 'passed',
          rationale: 'deterministic rubric evaluation',
          createdAt: '2026-06-27T00:05:00Z',
        },
        {
          id: 'eval-fail',
          rubricId: rubricAssets[0].id,
          rubricVersion: 'v1.0',
          rubricSnapshot: rubricAssets[0],
          subjectType: 'regression_run_sample',
          subjectId: 'sample-b',
          artifactText: 'thin sample',
          dimensionScores: [{ name: 'Accuracy', weight: 100, score: 42 }],
          score: 42,
          status: 'failed',
          rationale: 'missing evidence',
          createdAt: '2026-06-27T00:06:00Z',
        },
      ],
    }
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (input === `/api/workspaces/${workspace.id}/evaluations/overview`) {
        return response(overview)
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/rubrics`) {
        return response([rubricAssets[0], otherRubric])
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/records`) {
        return response([])
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/sample-sets`) {
        return response([])
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/regression-runs/run-keep`) {
        return response(detailRun)
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/regression-runs`) {
        return response(runs)
      }
      return response({ detail: 'not found' }, 404)
    }))

    renderPage()

    expect(await screen.findByText('Regression Run History')).toBeInTheDocument()
    expect(screen.getByText('run-keep')).toBeInTheDocument()
    expect(screen.getByText('run-hidden')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Run Rubric 筛选'), rubricAssets[0].id)
    expect(screen.getByText('run-keep')).toBeInTheDocument()
    expect(screen.queryByText('run-hidden')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Run 状态筛选'), 'completed')
    await user.click(screen.getByRole('button', { name: '查看 Run 详情' }))

    const dialog = await screen.findByRole('dialog', { name: 'Regression Run Detail' })
    expect(within(dialog).getByText('run-keep')).toBeInTheDocument()
    expect(within(dialog).getByText('eval-pass')).toBeInTheDocument()
    expect(within(dialog).getByText('eval-fail')).toBeInTheDocument()
    expect(within(dialog).getByText('thin sample')).toBeInTheDocument()
    expect(within(dialog).getByText('missing evidence')).toBeInTheDocument()
  })

  it('compares two Regression Runs and shows sample status changes', async () => {
    const user = userEvent.setup()
    const runs = [
      {
        id: 'run-target',
        sampleSetId: 'sample-set-1',
        sampleSetName: 'Launch Golden Set',
        rubricId: rubricAssets[0].id,
        rubricName: rubricAssets[0].name,
        rubricVersion: 'v1.1',
        status: 'completed',
        totalSamples: 3,
        passedSamples: 2,
        failedSamples: 1,
        passRate: 70,
        evaluationIds: ['eval-a-target', 'eval-b-target', 'eval-c-target'],
        records: [],
        createdBy: 'user-1',
        createdAt: '2026-06-27T00:10:00Z',
        completedAt: '2026-06-27T00:10:00Z',
      },
      {
        id: 'run-base',
        sampleSetId: 'sample-set-1',
        sampleSetName: 'Launch Golden Set',
        rubricId: rubricAssets[0].id,
        rubricName: rubricAssets[0].name,
        rubricVersion: 'v1.0',
        status: 'completed',
        totalSamples: 3,
        passedSamples: 1,
        failedSamples: 2,
        passRate: 40,
        evaluationIds: ['eval-a-base', 'eval-b-base', 'eval-c-base'],
        records: [],
        createdBy: 'user-1',
        createdAt: '2026-06-27T00:00:00Z',
        completedAt: '2026-06-27T00:00:00Z',
      },
    ]
    const detailBase = {
      ...runs[1],
      records: [
        {
          id: 'eval-a-base',
          rubricId: rubricAssets[0].id,
          rubricVersion: 'v1.0',
          rubricSnapshot: rubricAssets[0],
          subjectType: 'regression_run_sample',
          subjectId: 'sample-a',
          artifactText: 'sample-a old output',
          dimensionScores: [{ name: 'Accuracy', weight: 100, score: 42 }],
          score: 42,
          status: 'failed',
          rationale: 'missing evidence',
          createdAt: '2026-06-27T00:00:00Z',
        },
        {
          id: 'eval-b-base',
          rubricId: rubricAssets[0].id,
          rubricVersion: 'v1.0',
          rubricSnapshot: rubricAssets[0],
          subjectType: 'regression_run_sample',
          subjectId: 'sample-b',
          artifactText: 'sample-b old output',
          dimensionScores: [{ name: 'Accuracy', weight: 100, score: 92 }],
          score: 92,
          status: 'passed',
          rationale: 'strong evidence',
          createdAt: '2026-06-27T00:01:00Z',
        },
        {
          id: 'eval-c-base',
          rubricId: rubricAssets[0].id,
          rubricVersion: 'v1.0',
          rubricSnapshot: rubricAssets[0],
          subjectType: 'regression_run_sample',
          subjectId: 'sample-c',
          artifactText: 'sample-c old output',
          dimensionScores: [{ name: 'Accuracy', weight: 100, score: 45 }],
          score: 45,
          status: 'failed',
          rationale: 'thin reasoning',
          createdAt: '2026-06-27T00:02:00Z',
        },
      ],
    }
    const detailTarget = {
      ...runs[0],
      records: [
        {
          id: 'eval-a-target',
          rubricId: rubricAssets[0].id,
          rubricVersion: 'v1.1',
          rubricSnapshot: rubricAssets[0],
          subjectType: 'regression_run_sample',
          subjectId: 'sample-a',
          artifactText: 'sample-a improved output',
          dimensionScores: [{ name: 'Accuracy', weight: 100, score: 91 }],
          score: 91,
          status: 'passed',
          rationale: 'evidence added',
          createdAt: '2026-06-27T00:10:00Z',
        },
        {
          id: 'eval-b-target',
          rubricId: rubricAssets[0].id,
          rubricVersion: 'v1.1',
          rubricSnapshot: rubricAssets[0],
          subjectType: 'regression_run_sample',
          subjectId: 'sample-b',
          artifactText: 'sample-b regressed output',
          dimensionScores: [{ name: 'Accuracy', weight: 100, score: 40 }],
          score: 40,
          status: 'failed',
          rationale: 'lost citation',
          createdAt: '2026-06-27T00:11:00Z',
        },
        {
          id: 'eval-c-target',
          rubricId: rubricAssets[0].id,
          rubricVersion: 'v1.1',
          rubricSnapshot: rubricAssets[0],
          subjectType: 'regression_run_sample',
          subjectId: 'sample-c',
          artifactText: 'sample-c still weak',
          dimensionScores: [{ name: 'Accuracy', weight: 100, score: 44 }],
          score: 44,
          status: 'failed',
          rationale: 'still lacks facts',
          createdAt: '2026-06-27T00:12:00Z',
        },
      ],
    }
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
      if (input === `/api/workspaces/${workspace.id}/evaluations/sample-sets`) {
        return response([])
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/regression-runs/run-base`) {
        return response(detailBase)
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/regression-runs/run-target`) {
        return response(detailTarget)
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/regression-runs`) {
        return response(runs)
      }
      return response({ detail: 'not found' }, 404)
    }))

    renderPage()

    expect(await screen.findByText('Regression Run History')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('基准 Run'), 'run-base')
    await user.selectOptions(screen.getByLabelText('目标 Run'), 'run-target')
    await user.click(screen.getByRole('button', { name: '对比 Run' }))

    const comparison = await screen.findByRole('region', { name: 'Regression Run Comparison' })
    expect(within(comparison).getByText('run-base')).toBeInTheDocument()
    expect(within(comparison).getByText('run-target')).toBeInTheDocument()
    expect(within(comparison).getByText('通过率变化 +30')).toBeInTheDocument()
    expect(within(comparison).getByText('失败样本变化 -1')).toBeInTheDocument()
    expect(within(comparison).getByText('sample-a')).toBeInTheDocument()
    expect(within(comparison).getByText('失败变通过')).toBeInTheDocument()
    expect(within(comparison).getByText('sample-b')).toBeInTheDocument()
    expect(within(comparison).getByText('通过变失败')).toBeInTheDocument()
    expect(within(comparison).getByText('sample-c')).toBeInTheDocument()
    expect(within(comparison).getByText('持续失败')).toBeInTheDocument()
  })

  it('shows Regression Run trend across recent runs', async () => {
    const runs = [
      {
        id: 'run-latest',
        sampleSetId: 'sample-set-1',
        sampleSetName: 'Launch Golden Set',
        rubricId: rubricAssets[0].id,
        rubricName: rubricAssets[0].name,
        rubricVersion: 'v1.2',
        status: 'completed',
        totalSamples: 5,
        passedSamples: 4,
        failedSamples: 1,
        passRate: 80,
        evaluationIds: ['eval-latest'],
        records: [],
        createdBy: 'user-1',
        createdAt: '2026-06-27T00:20:00Z',
        completedAt: '2026-06-27T00:20:00Z',
      },
      {
        id: 'run-middle',
        sampleSetId: 'sample-set-1',
        sampleSetName: 'Launch Golden Set',
        rubricId: rubricAssets[0].id,
        rubricName: rubricAssets[0].name,
        rubricVersion: 'v1.1',
        status: 'completed',
        totalSamples: 5,
        passedSamples: 3,
        failedSamples: 2,
        passRate: 60,
        evaluationIds: ['eval-middle'],
        records: [],
        createdBy: 'user-1',
        createdAt: '2026-06-27T00:10:00Z',
        completedAt: '2026-06-27T00:10:00Z',
      },
      {
        id: 'run-oldest',
        sampleSetId: 'sample-set-1',
        sampleSetName: 'Launch Golden Set',
        rubricId: rubricAssets[0].id,
        rubricName: rubricAssets[0].name,
        rubricVersion: 'v1.0',
        status: 'completed',
        totalSamples: 5,
        passedSamples: 2,
        failedSamples: 3,
        passRate: 40,
        evaluationIds: ['eval-oldest'],
        records: [],
        createdBy: 'user-1',
        createdAt: '2026-06-27T00:00:00Z',
        completedAt: '2026-06-27T00:00:00Z',
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
        return response([])
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/sample-sets`) {
        return response([])
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/regression-runs`) {
        return response(runs)
      }
      return response({ detail: 'not found' }, 404)
    }))

    renderPage()

    const trend = await screen.findByRole('region', { name: 'Regression Run Trend' })
    expect(within(trend).getByText('最新通过率 80%')).toBeInTheDocument()
    expect(within(trend).getByText('较上次 +20')).toBeInTheDocument()
    expect(within(trend).getByText('平均通过率 60%')).toBeInTheDocument()
    expect(within(trend).getByText('最佳通过率 80%')).toBeInTheDocument()
    expect(within(trend).getByText('3 runs')).toBeInTheDocument()
    expect(within(trend).getByLabelText('Regression Run run-oldest pass rate 40%')).toBeInTheDocument()
    expect(within(trend).getByLabelText('Regression Run run-middle pass rate 60%')).toBeInTheDocument()
    expect(within(trend).getByLabelText('Regression Run run-latest pass rate 80%')).toBeInTheDocument()
  })
})
