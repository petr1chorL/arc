import { render, screen, waitFor, within } from '@testing-library/react'
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

function renderPage(initialEntry = '/evaluations') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
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

  it('highlights a remediation task from a remediation task deep link', async () => {
    const remediationTask = {
      id: 'remediation-task-1',
      sourceRunId: 'run-artifact-1',
      clusterKey: 'artifact:artifact-version-2',
      title: '修复 Artifact artifact-version-2 的结构输出',
      priority: 'P1',
      sampleIds: ['artifact-version-2'],
      action: '缺少必填字段：summary',
      status: 'open',
      owner: '管理员',
      dueDate: null,
      isOverdue: false,
      activities: [],
      retestRunId: null,
      retestRun: null,
      createdBy: 'user-1',
      updatedBy: 'user-1',
      createdAt: '2026-06-29T09:00:00Z',
      updatedAt: '2026-06-29T09:00:00Z',
    }
    const nonArtifactRemediationTask = {
      ...remediationTask,
      id: 'remediation-task-2',
      sourceRunId: 'run-regression-1',
      clusterKey: 'Evidence',
      title: '修复证据完整性',
      sampleIds: ['sample-1'],
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
      if (input === `/api/workspaces/${workspace.id}/evaluations/regression-runs`) {
        return response([])
      }
      if (String(input).split('?')[0] === `/api/workspaces/${workspace.id}/evaluations/remediation-tasks`) {
        return response([remediationTask, nonArtifactRemediationTask])
      }
      return response({ detail: 'not found' }, 404)
    }))

    renderPage('/w/ai-capability-center/evaluations?taskId=remediation-task-1')

    const taskDetail = await screen.findByRole('region', {
      name: '修复任务详情 remediation-task-1',
    })
    expect(within(taskDetail).getByRole('heading', { name: '修复任务详情' })).toBeInTheDocument()
    expect(within(taskDetail).getByText('修复 Artifact artifact-version-2 的结构输出')).toBeInTheDocument()
    expect(within(taskDetail).getByText('优先级 P1')).toBeInTheDocument()
    expect(within(taskDetail).getByText('状态 open')).toBeInTheDocument()
    expect(within(taskDetail).getByText('负责人 管理员')).toBeInTheDocument()
    expect(within(taskDetail).getByText('来源 Run run-artifact-1')).toBeInTheDocument()
    expect(within(taskDetail).getByText('聚类 artifact:artifact-version-2')).toBeInTheDocument()
    expect(within(taskDetail).getByText('样本 1 个')).toBeInTheDocument()
    expect(within(taskDetail).getByText('缺少必填字段：summary')).toBeInTheDocument()
    expect(within(taskDetail).getByRole('link', {
      name: '查看 remediation-task-1 产出物',
    })).toHaveAttribute(
      'href',
      '/w/ai-capability-center/artifacts?artifactVersionId=artifact-version-2',
    )
    expect(within(taskDetail).getByRole('link', {
      name: '查看 remediation-task-1 运行链路',
    })).toHaveAttribute(
      'href',
      '/w/ai-capability-center/observability?runId=run-artifact-1',
    )

    const taskList = await screen.findByRole('region', { name: 'Remediation Tasks' })
    expect(within(taskList).getByText('当前定位任务 remediation-task-1')).toBeInTheDocument()
    expect(within(taskList).getByLabelText('修复任务 remediation-task-1')).toHaveClass('active')
    expect(within(taskList).getByRole('link', {
      name: '打开 remediation-task-1 详情',
    })).toHaveAttribute(
      'href',
      '/w/ai-capability-center/evaluations?taskId=remediation-task-1',
    )
    const artifactLink = within(taskList).getByRole('link', {
      name: '查看 remediation-task-1 产出物',
    })
    expect(artifactLink).toHaveAttribute(
      'href',
      '/w/ai-capability-center/artifacts?artifactVersionId=artifact-version-2',
    )
    const traceLink = within(taskList).getByRole('link', {
      name: '查看 remediation-task-1 运行链路',
    })
    expect(traceLink).toHaveAttribute(
      'href',
      '/w/ai-capability-center/observability?runId=run-artifact-1',
    )
    const nonArtifactTask = within(taskList).getByLabelText('修复任务 remediation-task-2')
    expect(within(nonArtifactTask).queryByRole('link', {
      name: '查看 remediation-task-2 产出物',
    })).not.toBeInTheDocument()
    expect(within(nonArtifactTask).getByRole('link', {
      name: '查看 remediation-task-2 运行链路',
    })).toHaveAttribute(
      'href',
      '/w/ai-capability-center/observability?runId=run-regression-1',
    )
    expect(within(nonArtifactTask).getByRole('link', {
      name: '打开 remediation-task-2 详情',
    })).toHaveAttribute(
      'href',
      '/w/ai-capability-center/evaluations?taskId=remediation-task-2',
    )
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

  it('configures LLM Judge fields when creating a rubric', async () => {
    const user = userEvent.setup()
    const createdRubric = {
      id: 'rubric-llm',
      name: 'LLM 评审量规',
      artifact: '调研报告',
      dimensions: [
        { name: '证据质量', weight: 100 },
      ],
      gate: '必须说明证据来源',
      passScore: 85,
      judgeType: 'llm',
      judgeModel: 'deepseek-v4-pro',
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
    await user.type(screen.getByLabelText('名称'), createdRubric.name)
    await user.type(screen.getByLabelText('适用产出物'), createdRubric.artifact)
    await user.type(screen.getByLabelText('硬性门禁'), createdRubric.gate)
    await user.clear(screen.getByLabelText('维度 1 名称'))
    await user.type(screen.getByLabelText('维度 1 名称'), createdRubric.dimensions[0].name)
    await user.selectOptions(screen.getByLabelText('评分器类型'), 'llm')
    await user.type(screen.getByLabelText('Judge 模型'), createdRubric.judgeModel)
    await user.click(screen.getByRole('button', { name: '保存评分量规' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/workspaces/${workspace.id}/evaluations/rubrics`,
      expect.objectContaining({ method: 'POST' }),
    ))
    const createInit = fetchMock.mock.calls.find(([url, init]) => (
      url === `/api/workspaces/${workspace.id}/evaluations/rubrics`
      && (init as RequestInit | undefined)?.method === 'POST'
    ))?.[1] as RequestInit
    expect(JSON.parse(String(createInit.body))).toMatchObject({
      judgeType: 'llm',
      judgeModel: 'deepseek-v4-pro',
    })
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

  it('summarizes LLM Judge calibration coverage from evaluation records', async () => {
    const llmRecords = [
      {
        id: 'llm-evaluation-1',
        rubricId: rubricAssets[0].id,
        rubricVersion: 'v1.0',
        rubricSnapshot: { ...rubricAssets[0], judgeType: 'llm', judgeModel: 'deepseek-v4-pro' },
        subjectType: 'manual',
        subjectId: 'sample-1',
        artifactText: 'Artifact with evidence.',
        dimensionScores: [{ name: '准确性', weight: 100, score: 88 }],
        score: 88,
        status: 'passed',
        rationale: 'llm judge passed',
        evaluatorType: 'llm',
        evaluatorModel: 'deepseek-v4-pro',
        evaluatorInput: { judgePromptVersion: 'llm-judge-v1' },
        createdAt: '2026-06-27T00:00:00Z',
      },
      {
        id: 'llm-evaluation-2',
        rubricId: rubricAssets[0].id,
        rubricVersion: 'v1.0',
        rubricSnapshot: { ...rubricAssets[0], judgeType: 'llm', judgeModel: 'deepseek-v4-pro' },
        subjectType: 'manual',
        subjectId: 'sample-2',
        artifactText: 'Artifact missing evidence.',
        dimensionScores: [{ name: '准确性', weight: 100, score: 60 }],
        score: 60,
        status: 'failed',
        rationale: 'llm judge failed',
        evaluatorType: 'llm',
        evaluatorModel: 'deepseek-v4-pro',
        evaluatorInput: { judgePromptVersion: 'llm-judge-v1' },
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
        return response(llmRecords)
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/sample-sets`) {
        return response([])
      }
      return response({ detail: 'not found' }, 404)
    }))

    renderPage()

    expect(await screen.findByRole('heading', { name: 'LLM Judge 校准' })).toBeInTheDocument()
    expect(screen.getByText('2 条样本')).toBeInTheDocument()
    expect(screen.getByText('50% 通过率')).toBeInTheDocument()
    expect(screen.getByText('deepseek-v4-pro')).toBeInTheDocument()
    expect(screen.getByText('llm-judge-v1')).toBeInTheDocument()
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
    const metrics = trend.querySelector('.trend-metrics')
    expect(metrics).not.toBeNull()
    expect(within(metrics as HTMLElement).getByText('最新通过率 80%')).toBeInTheDocument()
    expect(within(metrics as HTMLElement).getByText('较上次 +20')).toBeInTheDocument()
    expect(within(metrics as HTMLElement).getByText('平均通过率 60%')).toBeInTheDocument()
    expect(within(metrics as HTMLElement).getByText('最佳通过率 80%')).toBeInTheDocument()
    expect(within(trend).getByText('3 runs')).toBeInTheDocument()
    expect(within(trend).getByLabelText('Regression Run run-oldest pass rate 40%')).toBeInTheDocument()
    expect(within(trend).getByLabelText('Regression Run run-middle pass rate 60%')).toBeInTheDocument()
    expect(within(trend).getByLabelText('Regression Run run-latest pass rate 80%')).toBeInTheDocument()
  })

  it('shows Regression Run insight for declining risky runs', async () => {
    const runs = [
      {
        id: 'run-latest-risk',
        sampleSetId: 'sample-set-1',
        sampleSetName: 'Launch Golden Set',
        rubricId: rubricAssets[0].id,
        rubricName: rubricAssets[0].name,
        rubricVersion: 'v1.2',
        status: 'completed',
        totalSamples: 10,
        passedSamples: 6,
        failedSamples: 4,
        passRate: 60,
        evaluationIds: ['eval-latest-risk'],
        records: [],
        createdBy: 'user-1',
        createdAt: '2026-06-27T00:20:00Z',
        completedAt: '2026-06-27T00:20:00Z',
      },
      {
        id: 'run-previous-healthy',
        sampleSetId: 'sample-set-1',
        sampleSetName: 'Launch Golden Set',
        rubricId: rubricAssets[0].id,
        rubricName: rubricAssets[0].name,
        rubricVersion: 'v1.1',
        status: 'completed',
        totalSamples: 20,
        passedSamples: 17,
        failedSamples: 3,
        passRate: 85,
        evaluationIds: ['eval-previous-healthy'],
        records: [],
        createdBy: 'user-1',
        createdAt: '2026-06-27T00:10:00Z',
        completedAt: '2026-06-27T00:10:00Z',
      },
      {
        id: 'run-oldest-healthy',
        sampleSetId: 'sample-set-1',
        sampleSetName: 'Launch Golden Set',
        rubricId: rubricAssets[0].id,
        rubricName: rubricAssets[0].name,
        rubricVersion: 'v1.0',
        status: 'completed',
        totalSamples: 10,
        passedSamples: 9,
        failedSamples: 1,
        passRate: 90,
        evaluationIds: ['eval-oldest-healthy'],
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

    const insight = await screen.findByRole('region', { name: 'Regression Run Insight' })
    expect(within(insight).getByText('质量下滑')).toBeInTheDocument()
    expect(within(insight).getByText('最新通过率 60%')).toBeInTheDocument()
    expect(within(insight).getByText('较上次 -25')).toBeInTheDocument()
    expect(within(insight).getByText('风险 Run 1 个')).toBeInTheDocument()
    expect(within(insight).getByText('建议：优先查看最新失败样本')).toBeInTheDocument()
  })

  it('shows failed sample clusters for the latest Regression Run', async () => {
    const user = userEvent.setup()
    const records = [
      {
        id: 'eval-evidence-a',
        rubricId: rubricAssets[0].id,
        rubricVersion: 'v1.2',
        rubricSnapshot: rubricAssets[0],
        subjectType: 'regression_run_sample',
        subjectId: 'sample-evidence-a',
        artifactText: 'Thin launch note without source evidence.',
        dimensionScores: [
          { name: 'Evidence', weight: 60, score: 35 },
          { name: 'Actionability', weight: 40, score: 58 },
        ],
        score: 44,
        status: 'failed',
        rationale: 'missing evidence',
        createdAt: '2026-06-27T00:20:00Z',
      },
      {
        id: 'eval-evidence-b',
        rubricId: rubricAssets[0].id,
        rubricVersion: 'v1.2',
        rubricSnapshot: rubricAssets[0],
        subjectType: 'regression_run_sample',
        subjectId: 'sample-evidence-b',
        artifactText: 'Claim-heavy launch plan without citations.',
        dimensionScores: [
          { name: 'Evidence', weight: 60, score: 40 },
          { name: 'Actionability', weight: 40, score: 55 },
        ],
        score: 46,
        status: 'failed',
        rationale: 'lost citation',
        createdAt: '2026-06-27T00:21:00Z',
      },
      {
        id: 'eval-actionability',
        rubricId: rubricAssets[0].id,
        rubricVersion: 'v1.2',
        rubricSnapshot: rubricAssets[0],
        subjectType: 'regression_run_sample',
        subjectId: 'sample-actionability',
        artifactText: 'Evidence is present, but there is no owner or next action.',
        dimensionScores: [
          { name: 'Evidence', weight: 60, score: 78 },
          { name: 'Actionability', weight: 40, score: 38 },
        ],
        score: 62,
        status: 'failed',
        rationale: 'missing owner and next action',
        createdAt: '2026-06-27T00:22:00Z',
      },
      {
        id: 'eval-pass',
        rubricId: rubricAssets[0].id,
        rubricVersion: 'v1.2',
        rubricSnapshot: rubricAssets[0],
        subjectType: 'regression_run_sample',
        subjectId: 'sample-pass',
        artifactText: 'Evidence-backed plan with owner, risk, and next action.',
        dimensionScores: [
          { name: 'Evidence', weight: 60, score: 88 },
          { name: 'Actionability', weight: 40, score: 86 },
        ],
        score: 87,
        status: 'passed',
        rationale: 'strong sample',
        createdAt: '2026-06-27T00:23:00Z',
      },
    ]
    const remediationTasks: Array<{
      id: string
      sourceRunId: string
      clusterKey: string
      title: string
      priority: string
      sampleIds: string[]
      action: string
      status: string
      activities: Array<{
        id: string
        taskId: string
        kind: string
        body: string
        attachmentRefs: string[]
        actorUserId: string
        actorDisplayName: string
        createdAt: string
      }>
      retestRunId: string | null
      retestRun: unknown | null
      createdBy: string
      updatedBy: string
      createdAt: string
      updatedAt: string
    }> = []
    const runs = [
      {
        id: 'run-latest-patterns',
        sampleSetId: 'sample-set-1',
        sampleSetName: 'Launch Golden Set',
        rubricId: rubricAssets[0].id,
        rubricName: rubricAssets[0].name,
        rubricVersion: 'v1.2',
        status: 'completed',
        totalSamples: 4,
        passedSamples: 1,
        failedSamples: 3,
        passRate: 25,
        evaluationIds: records.map((record) => record.id),
        records: [],
        createdBy: 'user-1',
        createdAt: '2026-06-27T00:20:00Z',
        completedAt: '2026-06-27T00:20:00Z',
      },
      {
        id: 'run-previous-patterns',
        sampleSetId: 'sample-set-1',
        sampleSetName: 'Launch Golden Set',
        rubricId: rubricAssets[0].id,
        rubricName: rubricAssets[0].name,
        rubricVersion: 'v1.1',
        status: 'completed',
        totalSamples: 4,
        passedSamples: 3,
        failedSamples: 1,
        passRate: 75,
        evaluationIds: ['eval-previous'],
        records: [],
        createdBy: 'user-1',
        createdAt: '2026-06-27T00:10:00Z',
        completedAt: '2026-06-27T00:10:00Z',
      },
    ]
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
        return response([])
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/regression-runs`) {
        return response(runs)
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/regression-runs/run-latest-patterns`) {
        return response({
          ...runs[0],
          records,
        })
      }
      const remediationTasksUrl = `/api/workspaces/${workspace.id}/evaluations/remediation-tasks`
      if (String(input).split('?')[0] === remediationTasksUrl) {
        if (init?.method === 'POST') {
          const payload = JSON.parse(String(init.body)) as {
            sourceRunId: string
            clusterKey: string
            title: string
            priority: string
            sampleIds: string[]
            action: string
          }
          const created = {
            id: 'remediation-task-1',
            ...payload,
            owner: '产品审核人',
            dueDate: '2024-01-01T00:00:00Z',
            isOverdue: true,
            activities: [],
            status: 'open',
            retestRunId: null,
            retestRun: null,
            createdBy: 'user-1',
            updatedBy: 'user-1',
            createdAt: '2026-06-27T00:30:00Z',
            updatedAt: '2026-06-27T00:30:00Z',
          }
          remediationTasks.splice(0, remediationTasks.length, created)
          return response(created, 201)
        }
        return response(remediationTasks)
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/remediation-tasks/remediation-task-1/activities`) {
        const payload = JSON.parse(String(init?.body)) as {
          body: string
          attachmentRefs: string[]
        }
        const activity = {
          id: 'activity-comment-1',
          taskId: 'remediation-task-1',
          kind: 'comment',
          body: payload.body,
          attachmentRefs: payload.attachmentRefs,
          actorUserId: 'user-1',
          actorDisplayName: 'Organization Admin',
          createdAt: '2026-06-27T00:31:30Z',
        }
        remediationTasks[0] = {
          ...remediationTasks[0],
          activities: [...(remediationTasks[0].activities ?? []), activity],
        }
        return response(activity, 201)
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/remediation-tasks/remediation-task-1`) {
        const payload = JSON.parse(String(init?.body)) as { status: string }
        remediationTasks[0] = {
          ...remediationTasks[0],
          status: payload.status,
          updatedAt: '2026-06-27T00:31:00Z',
        }
        return response(remediationTasks[0])
      }
      if (input === `/api/workspaces/${workspace.id}/evaluations/remediation-tasks/remediation-task-1/retest`) {
        remediationTasks[0] = {
          ...remediationTasks[0],
          status: 'in_progress',
          retestRunId: 'run-retest-1',
          retestRun: {
            id: 'run-retest-1',
            sampleSetId: null,
            sampleSetName: '修复复测',
            rubricId: rubricAssets[0].id,
            rubricName: rubricAssets[0].name,
            rubricVersion: 'v1.2',
            status: 'completed',
            totalSamples: 1,
            passedSamples: 0,
            failedSamples: 1,
            passRate: 0,
            evaluationIds: ['eval-retest-1'],
            records: [],
            createdBy: 'user-1',
            createdAt: '2026-06-27T00:32:00Z',
            completedAt: '2026-06-27T00:32:00Z',
          },
          activities: [
            ...(remediationTasks[0].activities ?? []),
            {
              id: 'activity-retest-failed',
              taskId: 'remediation-task-1',
              kind: 'retest_failed',
              body: '复测未通过：1 条样本失败，任务已回流',
              attachmentRefs: [],
              actorUserId: 'user-1',
              actorDisplayName: 'Organization Admin',
              createdAt: '2026-06-27T00:32:00Z',
            },
            {
              id: 'activity-retest-status',
              taskId: 'remediation-task-1',
              kind: 'status_change',
              body: '状态变更：done -> in_progress',
              attachmentRefs: [],
              actorUserId: 'user-1',
              actorDisplayName: 'Organization Admin',
              createdAt: '2026-06-27T00:32:01Z',
            },
          ],
          updatedAt: '2026-06-27T00:32:00Z',
        }
        return response(remediationTasks[0], 201)
      }
      return response({ detail: 'not found' }, 404)
    }))

    renderPage()

    const summary = await screen.findByRole('region', { name: 'Failure Pattern Summary' })
    expect(within(summary).getByText('最新失败样本 3 条')).toBeInTheDocument()
    expect(within(summary).getByText('Evidence 偏低')).toBeInTheDocument()
    expect(within(summary).getByText('2 samples')).toBeInTheDocument()
    expect(within(summary).getByText('Actionability 偏低')).toBeInTheDocument()
    expect(within(summary).getByText('1 sample')).toBeInTheDocument()
    expect(within(summary).getByText('sample-evidence-a')).toBeInTheDocument()
    expect(within(summary).getByText('sample-actionability')).toBeInTheDocument()

    const queue = await screen.findByRole('region', { name: 'Failure Remediation Queue' })
    expect(within(queue).getByText('P1')).toBeInTheDocument()
    expect(within(queue).getByText('修复 Evidence 偏低')).toBeInTheDocument()
    expect(within(queue).getByText('复测 2 条代表样本')).toBeInTheDocument()
    expect(within(queue).getByText('sample-evidence-a')).toBeInTheDocument()

    await user.click(within(queue).getAllByRole('button', { name: '创建任务' })[0])

    const taskList = await screen.findByRole('region', { name: 'Remediation Tasks' })
    expect(within(taskList).getByText('修复 Evidence 偏低')).toBeInTheDocument()
    expect(within(taskList).getByText('open')).toBeInTheDocument()
    expect(within(taskList).getByText('负责人 产品审核人')).toBeInTheDocument()
    expect(within(taskList).getByText('截止 2024-01-01')).toBeInTheDocument()
    expect(within(taskList).getByText('已逾期')).toBeInTheDocument()
    expect(within(taskList).getByText('处理时间线')).toBeInTheDocument()

    await user.click(within(taskList).getByRole('link', { name: '打开 remediation-task-1 详情' }))
    const taskDetail = await screen.findByRole('region', { name: '修复任务详情 remediation-task-1' })
    expect(within(taskDetail).getByText('状态 open')).toBeInTheDocument()

    await user.type(within(taskDetail).getByLabelText('详情评论内容'), '已补充竞品来源和截图证据')
    await user.type(within(taskDetail).getByLabelText('详情附件引用'), 'lark://doc/evidence-note')
    await user.click(within(taskDetail).getByRole('button', { name: '提交详情评论' }))
    expect(await within(taskDetail).findByText('已补充竞品来源和截图证据')).toBeInTheDocument()
    expect(within(taskDetail).getByText('附件 lark://doc/evidence-note')).toBeInTheDocument()
    expect(await within(taskList).findByText('已补充竞品来源和截图证据')).toBeInTheDocument()
    expect(within(taskList).getByText('附件 lark://doc/evidence-note')).toBeInTheDocument()
    expect(within(taskList).getByText('Organization Admin')).toBeInTheDocument()

    await user.selectOptions(within(taskList).getByLabelText('负责人筛选'), '产品审核人')
    await user.selectOptions(within(taskList).getByLabelText('优先级筛选'), 'P1')
    await user.selectOptions(within(taskList).getByLabelText('逾期筛选'), 'overdue')
    await waitFor(() => {
      const requestedUrls = vi.mocked(fetch).mock.calls.map(([url]) => String(url))
      expect(requestedUrls).toContain(
        `/api/workspaces/${workspace.id}/evaluations/remediation-tasks?owner=%E4%BA%A7%E5%93%81%E5%AE%A1%E6%A0%B8%E4%BA%BA&priority=P1&overdue=true`,
      )
    })

    await user.click(within(taskDetail).getByRole('button', { name: '标记处理中' }))
    expect(await within(taskDetail).findByText('状态 in_progress')).toBeInTheDocument()
    expect(await within(taskList).findByText('in_progress')).toBeInTheDocument()

    await user.click(within(taskDetail).getByRole('button', { name: '标记完成' }))
    expect(await within(taskDetail).findByText('状态 done')).toBeInTheDocument()
    expect(await within(taskList).findByText('done')).toBeInTheDocument()

    await user.click(within(taskDetail).getByRole('button', { name: '发起复测' }))
    expect(await within(taskDetail).findByText('复测失败已回流')).toBeInTheDocument()
    expect(await within(taskList).findByText('Retest Run')).toBeInTheDocument()
    expect(within(taskList).getByText('复测失败已回流')).toBeInTheDocument()
    expect(within(taskList).getByText('in_progress')).toBeInTheDocument()
    expect(within(taskList).getByText('run-retest-1')).toBeInTheDocument()
    expect(within(taskList).getByText('通过率 0%')).toBeInTheDocument()
    expect(within(taskList).getByText('失败 1')).toBeInTheDocument()
    expect(within(taskList).getByText('复测未通过：1 条样本失败，任务已回流')).toBeInTheDocument()
    expect(within(taskList).getByText('状态变更：done -> in_progress')).toBeInTheDocument()

    const loopBoard = await screen.findByRole('region', { name: 'Evaluation Loop Board' })
    expect(within(loopBoard).getByText('失败原因组 2')).toBeInTheDocument()
    expect(within(loopBoard).getByText('修复任务 1')).toBeInTheDocument()
    expect(within(loopBoard).getByText('未关闭风险 1')).toBeInTheDocument()
    expect(within(loopBoard).getByText('已复测 1')).toBeInTheDocument()
    expect(within(loopBoard).getByText('最近复测通过率 0%')).toBeInTheDocument()
    expect(within(loopBoard).getByText('优先关闭未完成修复任务')).toBeInTheDocument()
  })
})
