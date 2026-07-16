import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '../auth/WorkspaceContext'
import type { ExecutionRun } from '../types'
import { Runs } from './Runs'

const workspace = {
  id: 'workspace-1',
  slug: 'ai-capability-center',
  name: 'AI ????',
}

const run: ExecutionRun = {
  id: 'run-1',
  kind: 'workflow',
  name: '??????',
  workflowId: 'workflow-1',
  workflowVersion: 'v1.0.0',
  agentId: null,
  agentVersion: null,
  status: '???',
  input: '??????',
  output: '???????????????????',
  score: 100,
  model: 'configured-model',
  promptTokens: 12,
  completionTokens: 8,
  totalTokens: 20,
  costUsd: 0.001,
  durationMs: 1200,
  currentNode: '????',
  error: '',
  startedAt: '2026-06-24T08:00:00Z',
  completedAt: '2026-06-24T08:00:01Z',
  nodes: [{
    id: 'node-1',
    nodeId: 'agent',
    nodeType: 'agent',
    nodeName: '???? Agent',
    status: '???',
    input: '??????',
    output: '???????????????????',
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
  workflowName: '??????',
  runStatus: '???',
  sourceNodeName: '???? Agent',
  sourceNodeType: 'agent',
  sourceNodeStatus: '???',
  sourceNodeDurationMs: 1100,
  sourceNodeScore: 100,
  content: '???????????????????????????',
  score: 96,
  dataObjectDefinitionId: null,
  dataObjectVersionId: null,
  dataObjectSnapshot: null,
  schemaValidation: {
    status: 'passed',
    label: 'Schema ???',
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
  overallReason: '???????????????????',
  modelProviderName: 'DeepSeek ???',
  dimensions: [
    {
      dimensionId: 'completeness',
      dimensionName: '???',
      score: 90,
      weight: 40,
      weightedScore: 36,
      reason: '????????????',
    },
    {
      dimensionId: 'risk-control',
      dimensionName: '????',
      score: 80,
      weight: 60,
      weightedScore: 48,
      reason: '??????????????????',
    },
  ],
}

const evaluationWorkflowVersion = {
  id: 'workflow-version-evaluation',
  version: 'v1.0.0',
  createdAt: '2026-07-14T08:00:00Z',
  snapshot: {
    id: 'workflow-1',
    name: '??????',
    status: '???',
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
          label: '????',
          kind: 'evaluation',
          rubricRef: {
            rubricId: 'rubric-quality',
            versionId: 'rubric-version-1-2',
            version: 'v1.2.0',
            name: '????',
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
        return Promise.resolve(new Response(JSON.stringify([{ ...run, status: '?????' }]), { status: 200 }))
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

    expect(await screen.findByRole('heading', { name: '??????' })).toBeInTheDocument()
    expect(screen.getAllByText('???????????????????')).toHaveLength(2)
    expect(screen.getAllByText('???').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('?????')).not.toBeInTheDocument()
    expect(screen.getByText('20')).toBeInTheDocument()
    expect(screen.getByText(/?? 2 ?/)).toBeInTheDocument()
  })

  it('renders a workflow run graph with node status colors and labels', async () => {
    const visualRun = {
      ...run,
      status: '???',
      currentNode: '????',
      nodes: [
        { ...run.nodes[0], id: 'node-agent', nodeName: '???? Agent', status: '???' },
        { ...run.nodes[0], id: 'node-human', nodeId: 'human', nodeType: 'human', nodeName: '????', status: '???', durationMs: 0 },
      ],
    }
    const workflowVersion = {
      id: 'workflow-version-1',
      version: 'v1.0.0',
      createdAt: '2026-06-24T08:00:00Z',
      snapshot: {
        id: 'workflow-1',
        name: '??????',
        status: '???',
        version: 'v1.0.0',
        createdAt: '2026-06-24T08:00:00Z',
        updatedAt: '2026-06-24T08:00:00Z',
        inputSchema: {},
        outputSchema: {},
        nodes: [
          { id: 'agent', type: 'workflow', position: { x: 120, y: 160 }, data: { label: '???? Agent', kind: 'agent' } },
          { id: 'human', type: 'workflow', position: { x: 420, y: 160 }, data: { label: '????', kind: 'human' } },
          { id: 'end', type: 'workflow', position: { x: 720, y: 160 }, data: { label: '????', kind: 'end' } },
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

    expect(await screen.findByText('???????')).toBeInTheDocument()
    expect(await screen.findByText(/3\s*???/)).toBeInTheDocument()
    expect(screen.getByText(/???\s*2\s*?/)).toBeInTheDocument()
    expect(screen.getByText(/?????????/)).toBeInTheDocument()
    expect(screen.getAllByText('???? Agent').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('????').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('????').length).toBeGreaterThanOrEqual(1)
    const agentStep = Array.from(document.querySelectorAll('.run-graph-step'))
      .find((step) => step.textContent?.includes('???? Agent'))
    expect(agentStep?.querySelector('.run-graph-step-heading')).toBeInTheDocument()
    expect(agentStep?.querySelector('.run-graph-node-title')).toBeInTheDocument()
    expect(screen.getAllByTestId('run-graph-connector')).toHaveLength(2)
    expect(screen.getAllByText(/??/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/??/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/???/).length).toBeGreaterThanOrEqual(1)
  })

  it('filters workflow runs by displayed status', async () => {
    const user = userEvent.setup()
    const failedRun = {
      ...run,
      id: 'run-failed',
      name: 'Failed workflow run',
      status: '??',
      output: '',
      error: '????',
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
    await user.selectOptions(screen.getByLabelText('??????'), '??')

    expect(screen.getByRole('button', { name: /Failed workflow run/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /??????/ })).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Failed workflow run' })).toBeInTheDocument()
  })

  it('keeps the current graph node green when the run has completed', async () => {
    const completedRun = {
      ...run,
      currentNode: '????',
      nodes: [
        { ...run.nodes[0], id: 'node-agent', nodeName: '???? Agent', status: '???' },
        { ...run.nodes[0], id: 'node-end', nodeId: 'end', nodeType: 'end', nodeName: '????', status: '???', durationMs: 0 },
      ],
    }
    const workflowVersion = {
      id: 'workflow-version-1',
      version: 'v1.0.0',
      createdAt: '2026-06-24T08:00:00Z',
      snapshot: {
        id: 'workflow-1',
        name: '??????',
        status: '???',
        version: 'v1.0.0',
        createdAt: '2026-06-24T08:00:00Z',
        updatedAt: '2026-06-24T08:00:00Z',
        inputSchema: {},
        outputSchema: {},
        nodes: [
          { id: 'agent', type: 'workflow', position: { x: 120, y: 160 }, data: { label: '???? Agent', kind: 'agent' } },
          { id: 'end', type: 'workflow', position: { x: 420, y: 160 }, data: { label: '????', kind: 'end' } },
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

    expect(await screen.findByText('???????')).toBeInTheDocument()
    const completedStep = Array.from(document.querySelectorAll('.run-graph-step'))
      .find((step) => step.textContent?.includes('????'))
    expect(completedStep).toHaveClass('success')
    expect(completedStep).toHaveClass('current')
  })

  it('keeps the run center read-only for failed workflow runs', async () => {
    const failedRun = {
      ...run,
      id: 'run-failed',
      status: '??',
      output: '',
      error: 'Agent ????????????????',
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

    expect(await screen.findByText('Agent ????????????????')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '??????' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '????' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '??????' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '????' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '????' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByText('????')).not.toBeInTheDocument()
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

    expect(await screen.findByRole('heading', { name: '??????' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Second workflow run/ }))

    expect(await screen.findByRole('heading', { name: 'Second workflow run' })).toBeInTheDocument()
    expect(window.location.search).toBe('?tab=history&runId=run-second')
  })

  it('links a waiting workflow run to the human review queue', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      if (url === `/api/workspaces/${workspace.id}/runs`) {
        return Promise.resolve(new Response(JSON.stringify([{ ...run, status: '???', currentNode: '????' }]), { status: 200 }))
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

    expect(await screen.findByText('??????')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '???????' })).toHaveAttribute(
      'href',
      '/w/ai-capability-center/reviews',
    )
  })

  it('renders artifacts inside the run center grouped by workflow node', async () => {
    const visualRun = {
      ...run,
      nodes: [
        { ...run.nodes[0], id: 'node-agent', nodeName: '???? Agent', status: '???' },
        { ...run.nodes[0], id: 'node-human', nodeId: 'human', nodeType: 'human', nodeName: '????', status: '???', output: '' },
      ],
    }
    const workflowVersion = {
      id: 'workflow-version-1',
      version: 'v1.0.0',
      createdAt: '2026-06-24T08:00:00Z',
      snapshot: {
        id: 'workflow-1',
        name: '??????',
        status: '???',
        version: 'v1.0.0',
        createdAt: '2026-06-24T08:00:00Z',
        updatedAt: '2026-06-24T08:00:00Z',
        inputSchema: {},
        outputSchema: {},
        nodes: [
          { id: 'agent', type: 'workflow', position: { x: 120, y: 160 }, data: { label: '???? Agent', kind: 'agent' } },
          { id: 'human', type: 'workflow', position: { x: 420, y: 160 }, data: { label: '????', kind: 'human' } },
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

    expect(await screen.findByText('?????')).toBeInTheDocument()
    expect(await screen.findByText('???????????????????????????')).toBeInTheDocument()
    expect(screen.getByText('artifact-version-1')).toBeInTheDocument()
    expect(screen.getByText('Schema ???')).toBeInTheDocument()
    const artifactSection = screen.getByRole('region', { name: '?????' })
    const humanNode = within(artifactSection).getByText('????').closest('.run-artifact-node')
    expect(humanNode).toHaveTextContent('?')
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
          nodeName: '????',
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

    expect(await screen.findByRole('heading', { name: '??????' })).toBeInTheDocument()
    const evaluationRegion = await screen.findByRole('region', { name: '????' })
    expect(evaluationRegion).toHaveTextContent('??')
    expect(evaluationRegion).toHaveTextContent('84')
    expect(evaluationRegion).toHaveTextContent('????')
    expect(evaluationRegion).toHaveTextContent('???????????????????')
    expect(evaluationRegion).toHaveTextContent('???? ? v1.2.0')
    expect(evaluationRegion).toHaveTextContent('DeepSeek ???')
    expect(evaluationRegion).toHaveTextContent('deepseek-chat')

    const completeness = within(evaluationRegion).getByRole('group', { name: '???' })
    expect(completeness).toHaveTextContent(/90\s*?/)
    expect(completeness).toHaveTextContent(/??\s*40%/)
    expect(completeness).toHaveTextContent(/???\s*36\.00/)
    expect(completeness).toHaveTextContent('????????????')

    const riskControl = within(evaluationRegion).getByRole('group', { name: '????' })
    expect(riskControl).toHaveTextContent(/80\s*?/)
    expect(riskControl).toHaveTextContent(/??\s*60%/)
    expect(riskControl).toHaveTextContent(/???\s*48\.00/)
    expect(riskControl).toHaveTextContent('??????????????????')
    expect(screen.queryByText(serializedResult)).not.toBeInTheDocument()
  })

  it('shows the evaluation node error when execution failed before producing output', async () => {
    const failedRun: ExecutionRun = {
      ...run,
      status: '????',
      error: '?????????????',
      nodes: [
        {
          ...run.nodes[0],
          id: 'node-evaluation',
          nodeId: 'evaluation-1',
          nodeType: 'evaluation',
          nodeName: '????',
          status: '??',
          output: '',
          error: '????????',
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
    expect(alert).toHaveTextContent('??????')
    expect(alert).toHaveTextContent('????????')
    expect(alert).not.toHaveTextContent('????????')
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
          nodeName: '????',
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

    expect(await screen.findByRole('heading', { name: '??????' })).toBeInTheDocument()
    expect(screen.getAllByText('????').length).toBeGreaterThanOrEqual(1)
    expect(await screen.findByRole('alert')).toHaveTextContent('????????')
  })
})
