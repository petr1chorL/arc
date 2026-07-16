import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '../auth/WorkspaceContext'
import type { ExecutionRun } from '../types'
import { Runs } from './Runs'

const workspace = {
  id: 'workspace-1',
  slug: 'ai-capability-center',
  name: 'AI 能力中心',
}

const run: ExecutionRun = {
  id: 'run-1',
  kind: 'workflow',
  name: '新品研究流程',
  workflowId: 'workflow-1',
  workflowVersion: 'v1.0.0',
  agentId: null,
  agentVersion: null,
  status: '已完成',
  input: '分析用户需求',
  output: '这是由真实运行记录返回的完整分析结果。',
  score: 100,
  model: 'configured-model',
  promptTokens: 12,
  completionTokens: 8,
  totalTokens: 20,
  costUsd: 0.001,
  durationMs: 1200,
  currentNode: '流程结束',
  error: '',
  startedAt: '2026-06-24T08:00:00Z',
  completedAt: '2026-06-24T08:00:01Z',
  nodes: [{
    id: 'node-1',
    nodeId: 'agent',
    nodeType: 'agent',
    nodeName: '需求分析 Agent',
    status: '已完成',
    input: '分析用户需求',
    output: '这是由真实运行记录返回的完整分析结果。',
    model: 'configured-model',
    promptTokens: 12,
    completionTokens: 8,
    totalTokens: 20,
    costUsd: 0.001,
    durationMs: 1100,
    attempts: 2,
    score: 100,
    error: '',
    startedAt: '2026-06-24T08:00:00Z',
    completedAt: '2026-06-24T08:00:01Z',
  }],
}

const nodeArtifact = {
  artifactId: 'artifact-1',
  artifactVersionId: 'artifact-version-1',
  version: 1,
  runId: 'run-1',
  sourceNodeRunId: 'node-agent',
  workflowName: '新品研究流程',
  runStatus: '已完成',
  sourceNodeName: '选择执行 Agent',
  sourceNodeType: 'agent',
  sourceNodeStatus: '已完成',
  sourceNodeDurationMs: 1100,
  sourceNodeScore: 100,
  content: '节点产出物内容：包含结构化分析、关键证据和下一步建议。',
  score: 96,
  dataObjectDefinitionId: null,
  dataObjectVersionId: null,
  dataObjectSnapshot: null,
  schemaValidation: {
    status: 'passed',
    label: 'Schema 已通过',
    reasons: [],
  },
  createdAt: '2026-06-24T08:00:01Z',
}

const evaluationResult = {
  evaluationRecordId: 'evaluation-record-1',
  templateId: 'rubric-quality',
  templateVersion: 'v1.2.0',
  totalScore: 84,
  passed: true,
  overallReason: '整体方案可执行，但风险预案仍不够充分。',
  modelProviderName: 'DeepSeek 主模型',
  dimensions: [
    {
      dimensionId: 'completeness',
      dimensionName: '完整性',
      score: 90,
      weight: 40,
      weightedScore: 36,
      reason: '目标、步骤和交付物完整。',
    },
    {
      dimensionId: 'risk-control',
      dimensionName: '风险控制',
      score: 80,
      weight: 60,
      weightedScore: 48,
      reason: '识别了主要风险，但触发阈值仍需补充。',
    },
  ],
}

const evaluationWorkflowVersion = {
  id: 'workflow-version-evaluation',
  version: 'v1.0.0',
  createdAt: '2026-07-14T08:00:00Z',
  snapshot: {
    id: 'workflow-1',
    name: '新品研究流程',
    status: '已发布',
    version: 'v1.0.0',
    createdAt: '2026-07-14T08:00:00Z',
    updatedAt: '2026-07-14T08:00:00Z',
    inputSchema: {},
    outputSchema: {},
    nodes: [
      {
        id: 'evaluation-1',
        type: 'evaluation',
        position: { x: 320, y: 160 },
        data: {
          label: '方案评估',
          kind: 'evaluation',
          rubricRef: {
            rubricId: 'rubric-quality',
            versionId: 'rubric-version-1-2',
            version: 'v1.2.0',
            name: '质量模板',
          },
        },
      },
    ],
    edges: [],
  },
}

function evaluationRunFetch(runData: ExecutionRun) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? `${input.pathname}${input.search}`
        : input.url
    if (url === `/api/workspaces/${workspace.id}/runs`) {
      return Promise.resolve(new Response(JSON.stringify([runData]), { status: 200 }))
    }
    if (url === `/api/workspaces/${workspace.id}/workflows/workflow-1/versions`) {
      return Promise.resolve(new Response(JSON.stringify([evaluationWorkflowVersion]), { status: 200 }))
    }
    if (url === `/api/workspaces/${workspace.id}/artifacts?runId=run-1`) {
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
  })
}

describe('Runs', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    window.history.pushState({}, '', '/')
  })

  it('renders persisted run metrics, output and node attempts', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      if (url === `/api/workspaces/${workspace.id}/runs`) {
        return Promise.resolve(new Response(JSON.stringify([{ ...run, status: '宸插畬鎴?' }]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/artifacts?runId=run-1`) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/artifacts?runId=run-failed`) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    }))

    render(
      <WorkspaceProvider workspace={workspace}>
        <Runs />
      </WorkspaceProvider>,
    )

    expect(await screen.findByRole('heading', { name: '新品研究流程' })).toBeInTheDocument()
    expect(screen.getAllByText('这是由真实运行记录返回的完整分析结果。')).toHaveLength(2)
    expect(screen.getAllByText('已完成').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('宸插畬鎴?')).not.toBeInTheDocument()
    expect(screen.getByText('20')).toBeInTheDocument()
    expect(screen.getByText(/尝试 2 次/)).toBeInTheDocument()
  })

  it('renders a workflow run graph with node status colors and labels', async () => {
    const visualRun = {
      ...run,
      status: '需介入',
      currentNode: '人工审核',
      nodes: [
        { ...run.nodes[0], id: 'node-agent', nodeName: '选择执行 Agent', status: '已完成' },
        { ...run.nodes[0], id: 'node-human', nodeId: 'human', nodeType: 'human', nodeName: '人工审核', status: '需介入', durationMs: 0 },
      ],
    }
    const workflowVersion = {
      id: 'workflow-version-1',
      version: 'v1.0.0',
      createdAt: '2026-06-24T08:00:00Z',
      snapshot: {
        id: 'workflow-1',
        name: '新品研究流程',
        status: '已发布',
        version: 'v1.0.0',
        createdAt: '2026-06-24T08:00:00Z',
        updatedAt: '2026-06-24T08:00:00Z',
        inputSchema: {},
        outputSchema: {},
        nodes: [
          { id: 'agent', type: 'workflow', position: { x: 120, y: 160 }, data: { label: '选择执行 Agent', kind: 'agent' } },
          { id: 'human', type: 'workflow', position: { x: 420, y: 160 }, data: { label: '人工审核', kind: 'human' } },
          { id: 'end', type: 'workflow', position: { x: 720, y: 160 }, data: { label: '流程完成', kind: 'end' } },
        ],
        edges: [
          { id: 'agent-human', source: 'agent', target: 'human' },
          { id: 'human-end', source: 'human', target: 'end' },
        ],
      },
    }
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      if (url === `/api/workspaces/${workspace.id}/runs`) {
        return Promise.resolve(new Response(JSON.stringify([visualRun]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/workflows/workflow-1/versions`) {
        return Promise.resolve(new Response(JSON.stringify([workflowVersion]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/artifacts?runId=run-1`) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <WorkspaceProvider workspace={workspace}>
        <Runs />
      </WorkspaceProvider>,
    )

    expect(await screen.findByText('完整工作流链路')).toBeInTheDocument()
    expect(await screen.findByText(/3\s*个节点/)).toBeInTheDocument()
    expect(screen.getByText(/已执行\s*2\s*个/)).toBeInTheDocument()
    expect(screen.getByText(/当前节点：人工审核/)).toBeInTheDocument()
    expect(screen.getAllByText('选择执行 Agent').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('人工审核').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('流程完成').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByTestId('run-graph-connector')).toHaveLength(2)
    expect(screen.getAllByText(/通过/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/等待/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/未开始/).length).toBeGreaterThanOrEqual(1)
  })

  it('filters workflow runs by displayed status', async () => {
    const user = userEvent.setup()
    const failedRun = {
      ...run,
      id: 'run-failed',
      name: 'Failed workflow run',
      status: '失败',
      output: '',
      error: '失败运行',
    }
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      if (url === `/api/workspaces/${workspace.id}/runs`) {
        return Promise.resolve(new Response(JSON.stringify([run, failedRun]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/artifacts?runId=run-1`) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <WorkspaceProvider workspace={workspace}>
        <Runs />
      </WorkspaceProvider>,
    )

    expect(await screen.findByRole('button', { name: /Failed workflow run/ })).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('流程状态筛选'), '失败')

    expect(screen.getByRole('button', { name: /Failed workflow run/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /新品研究流程/ })).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Failed workflow run' })).toBeInTheDocument()
  })

  it('keeps the current graph node green when the run has completed', async () => {
    const completedRun = {
      ...run,
      currentNode: '流程完成',
      nodes: [
        { ...run.nodes[0], id: 'node-agent', nodeName: '选择执行 Agent', status: '已完成' },
        { ...run.nodes[0], id: 'node-end', nodeId: 'end', nodeType: 'end', nodeName: '流程完成', status: '已完成', durationMs: 0 },
      ],
    }
    const workflowVersion = {
      id: 'workflow-version-1',
      version: 'v1.0.0',
      createdAt: '2026-06-24T08:00:00Z',
      snapshot: {
        id: 'workflow-1',
        name: '新品研究流程',
        status: '已发布',
        version: 'v1.0.0',
        createdAt: '2026-06-24T08:00:00Z',
        updatedAt: '2026-06-24T08:00:00Z',
        inputSchema: {},
        outputSchema: {},
        nodes: [
          { id: 'agent', type: 'workflow', position: { x: 120, y: 160 }, data: { label: '选择执行 Agent', kind: 'agent' } },
          { id: 'end', type: 'workflow', position: { x: 420, y: 160 }, data: { label: '流程完成', kind: 'end' } },
        ],
        edges: [
          { id: 'agent-end', source: 'agent', target: 'end' },
        ],
      },
    }
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      if (url === `/api/workspaces/${workspace.id}/runs`) {
        return Promise.resolve(new Response(JSON.stringify([completedRun]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/workflows/workflow-1/versions`) {
        return Promise.resolve(new Response(JSON.stringify([workflowVersion]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/artifacts?runId=run-1`) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <WorkspaceProvider workspace={workspace}>
        <Runs />
      </WorkspaceProvider>,
    )

    expect(await screen.findByText('完整工作流链路')).toBeInTheDocument()
    const completedStep = Array.from(document.querySelectorAll('.run-graph-step'))
      .find((step) => step.textContent?.includes('流程完成'))
    expect(completedStep).toHaveClass('success')
    expect(completedStep).toHaveClass('current')
  })

  it('keeps the run center read-only for failed workflow runs', async () => {
    const failedRun = {
      ...run,
      id: 'run-failed',
      status: '失败',
      output: '',
      error: 'Agent 执行失败，请去工作流编排重新运行',
    }
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      if (url === `/api/workspaces/${workspace.id}/runs`) {
        return Promise.resolve(new Response(JSON.stringify([failedRun]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/artifacts?runId=run-failed`) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <WorkspaceProvider workspace={workspace}>
        <Runs />
      </WorkspaceProvider>,
    )

    expect(await screen.findByText('Agent 执行失败，请去工作流编排重新运行')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '从失败点恢复' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重新运行' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑输入重跑' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '批量重跑' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '批量恢复' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByText('操作历史')).not.toBeInTheDocument()
  })

  it('selects the run requested by the runId query parameter', async () => {
    window.history.pushState({}, '', '/w/ai-capability-center/runs?runId=run-deep-link')
    const deepLinkedRun = {
      ...run,
      id: 'run-deep-link',
      name: 'Deep linked workflow run',
      output: 'Deep linked run output',
      nodes: [{ ...run.nodes[0], output: 'Deep linked run output' }],
    }
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      if (url === `/api/workspaces/${workspace.id}/runs`) {
        return Promise.resolve(new Response(JSON.stringify([run, deepLinkedRun]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/artifacts?runId=run-deep-link`) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <WorkspaceProvider workspace={workspace}>
        <Runs />
      </WorkspaceProvider>,
    )

    expect(await screen.findByRole('heading', { name: 'Deep linked workflow run' })).toBeInTheDocument()
    expect(screen.getAllByText('Deep linked run output')).toHaveLength(2)
  })

  it('updates the runId query parameter when selecting a run', async () => {
    const user = userEvent.setup()
    window.history.pushState({}, '', '/w/ai-capability-center/runs?tab=history')
    const secondRun = {
      ...run,
      id: 'run-second',
      name: 'Second workflow run',
      output: 'Second run output',
      nodes: [{ ...run.nodes[0], output: 'Second run output' }],
    }
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      if (url === `/api/workspaces/${workspace.id}/runs`) {
        return Promise.resolve(new Response(JSON.stringify([run, secondRun]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/artifacts?runId=run-1`) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/artifacts?runId=run-second`) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <WorkspaceProvider workspace={workspace}>
        <Runs />
      </WorkspaceProvider>,
    )

    expect(await screen.findByRole('heading', { name: '新品研究流程' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Second workflow run/ }))

    expect(await screen.findByRole('heading', { name: 'Second workflow run' })).toBeInTheDocument()
    expect(window.location.search).toBe('?tab=history&runId=run-second')
  })

  it('links a waiting workflow run to the human review queue', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      if (url === `/api/workspaces/${workspace.id}/runs`) {
        return Promise.resolve(new Response(JSON.stringify([{ ...run, status: '需介入', currentNode: '人工审核' }]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/artifacts?runId=run-1`) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    }))

    render(
      <WorkspaceProvider workspace={workspace}>
        <Runs />
      </WorkspaceProvider>,
    )

    expect(await screen.findByText('等待人工审核')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '去人工审核处理' })).toHaveAttribute(
      'href',
      '/w/ai-capability-center/reviews',
    )
  })

  it('renders artifacts inside the run center grouped by workflow node', async () => {
    const visualRun = {
      ...run,
      nodes: [
        { ...run.nodes[0], id: 'node-agent', nodeName: '选择执行 Agent', status: '已完成' },
        { ...run.nodes[0], id: 'node-human', nodeId: 'human', nodeType: 'human', nodeName: '人工审核', status: '已完成', output: '' },
      ],
    }
    const workflowVersion = {
      id: 'workflow-version-1',
      version: 'v1.0.0',
      createdAt: '2026-06-24T08:00:00Z',
      snapshot: {
        id: 'workflow-1',
        name: '新品研究流程',
        status: '已发布',
        version: 'v1.0.0',
        createdAt: '2026-06-24T08:00:00Z',
        updatedAt: '2026-06-24T08:00:00Z',
        inputSchema: {},
        outputSchema: {},
        nodes: [
          { id: 'agent', type: 'workflow', position: { x: 120, y: 160 }, data: { label: '选择执行 Agent', kind: 'agent' } },
          { id: 'human', type: 'workflow', position: { x: 420, y: 160 }, data: { label: '人工审核', kind: 'human' } },
        ],
        edges: [
          { id: 'agent-human', source: 'agent', target: 'human' },
        ],
      },
    }
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      if (url === `/api/workspaces/${workspace.id}/runs`) {
        return Promise.resolve(new Response(JSON.stringify([visualRun]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/workflows/workflow-1/versions`) {
        return Promise.resolve(new Response(JSON.stringify([workflowVersion]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/artifacts?runId=run-1`) {
        return Promise.resolve(new Response(JSON.stringify([nodeArtifact]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <WorkspaceProvider workspace={workspace}>
        <Runs />
      </WorkspaceProvider>,
    )

    expect(await screen.findByText('节点产出物')).toBeInTheDocument()
    expect(await screen.findByText('节点产出物内容：包含结构化分析、关键证据和下一步建议。')).toBeInTheDocument()
    expect(screen.getByText('artifact-version-1')).toBeInTheDocument()
    expect(screen.getByText('Schema 已通过')).toBeInTheDocument()
    const artifactSection = screen.getByRole('region', { name: '节点产出物' })
    const humanNode = within(artifactSection).getByText('人工审核').closest('.run-artifact-node')
    expect(humanNode).toHaveTextContent('无')
  })

  it('deletes a selected run record after confirmation', async () => {
    const user = userEvent.setup()
    const firstRun = {
      ...run,
      name: 'First workflow run',
      output: 'First run output',
      nodes: [{ ...run.nodes[0], output: 'First run output' }],
    }
    const secondRun = {
      ...run,
      id: 'run-second',
      name: 'Second workflow run',
      output: 'Second run output',
      nodes: [{ ...run.nodes[0], output: 'Second run output' }],
    }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      if (url === `/api/workspaces/${workspace.id}/runs`) {
        return Promise.resolve(new Response(JSON.stringify([firstRun, secondRun]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/artifacts?runId=run-1`) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/runs/run-1` && init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <WorkspaceProvider workspace={workspace}>
        <Runs />
      </WorkspaceProvider>,
    )

    expect(await screen.findByRole('heading', { name: 'First workflow run' })).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Delete run record' })[0])
    await user.click(screen.getByRole('button', { name: 'Confirm delete run record' }))

    expect(fetchMock.mock.calls).toEqual(
      expect.arrayContaining([
        [
          `/api/workspaces/${workspace.id}/runs/run-1`,
          expect.objectContaining({ method: 'DELETE' }),
        ],
      ]),
    )
    expect(screen.queryByRole('button', { name: /First workflow run/ })).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Second workflow run' })).toBeInTheDocument()
  })


  it('renders a complete structured evaluation result with a reason for every dimension', async () => {
    const serializedResult = JSON.stringify(evaluationResult)
    const evaluationRun = {
      ...run,
      output: serializedResult,
      score: 84,
      nodes: [
        {
          ...run.nodes[0],
          id: 'node-evaluation',
          nodeId: 'evaluation-1',
          nodeType: 'evaluation',
          nodeName: '方案评估',
          output: serializedResult,
          model: 'deepseek-chat',
          score: 84,
          attempts: 1,
        },
      ],
    }
    vi.stubGlobal('fetch', evaluationRunFetch(evaluationRun))

    render(
      <WorkspaceProvider workspace={workspace}>
        <Runs />
      </WorkspaceProvider>,
    )

    expect(await screen.findByRole('heading', { name: '新品研究流程' })).toBeInTheDocument()
    const evaluationRegion = await screen.findByRole('region', { name: '评估结果' })
    expect(evaluationRegion).toHaveTextContent('总分')
    expect(evaluationRegion).toHaveTextContent('84')
    expect(evaluationRegion).toHaveTextContent('评估通过')
    expect(evaluationRegion).toHaveTextContent('整体方案可执行，但风险预案仍不够充分。')
    expect(evaluationRegion).toHaveTextContent('质量模板 · v1.2.0')
    expect(evaluationRegion).toHaveTextContent('DeepSeek 主模型')
    expect(evaluationRegion).toHaveTextContent('deepseek-chat')

    const completeness = within(evaluationRegion).getByRole('group', { name: '完整性' })
    expect(completeness).toHaveTextContent(/90\s*分/)
    expect(completeness).toHaveTextContent(/权重\s*40%/)
    expect(completeness).toHaveTextContent(/加权分\s*36\.00/)
    expect(completeness).toHaveTextContent('目标、步骤和交付物完整。')

    const riskControl = within(evaluationRegion).getByRole('group', { name: '风险控制' })
    expect(riskControl).toHaveTextContent(/80\s*分/)
    expect(riskControl).toHaveTextContent(/权重\s*60%/)
    expect(riskControl).toHaveTextContent(/加权分\s*48\.00/)
    expect(riskControl).toHaveTextContent('识别了主要风险，但触发阈值仍需补充。')
    expect(screen.queryByText(serializedResult)).not.toBeInTheDocument()
  })

  it('shows the evaluation node error when execution failed before producing output', async () => {
    const failedRun: ExecutionRun = {
      ...run,
      status: '恢复失败',
      error: '工作流恢复失败，请稍后重试',
      nodes: [
        {
          ...run.nodes[0],
          id: 'node-evaluation',
          nodeId: 'evaluation-1',
          nodeType: 'evaluation',
          nodeName: '方案评估',
          status: '失败',
          output: '',
          error: '评估模型调用失败',
          model: 'deepseek-chat',
          score: null,
          attempts: 2,
        },
      ],
    }
    vi.stubGlobal('fetch', evaluationRunFetch(failedRun))

    render(
      <WorkspaceProvider workspace={workspace}>
        <Runs />
      </WorkspaceProvider>,
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('评估执行失败')
    expect(alert).toHaveTextContent('评估模型调用失败')
    expect(alert).not.toHaveTextContent('评估结果格式无效')
  })

  it('degrades a damaged evaluation output without crashing the run detail', async () => {
    const damagedOutput = '{"totalScore":84,"dimensions":"invalid"}'
    const damagedRun = {
      ...run,
      output: damagedOutput,
      score: 84,
      nodes: [
        {
          ...run.nodes[0],
          id: 'node-evaluation',
          nodeId: 'evaluation-1',
          nodeType: 'evaluation',
          nodeName: '方案评估',
          output: damagedOutput,
          model: 'deepseek-chat',
          score: 84,
          attempts: 1,
        },
      ],
    }
    vi.stubGlobal('fetch', evaluationRunFetch(damagedRun))

    render(
      <WorkspaceProvider workspace={workspace}>
        <Runs />
      </WorkspaceProvider>,
    )

    expect(await screen.findByRole('heading', { name: '新品研究流程' })).toBeInTheDocument()
    expect(screen.getAllByText('方案评估').length).toBeGreaterThanOrEqual(1)
    expect(await screen.findByRole('alert')).toHaveTextContent('评估结果格式无效')
  })
})
