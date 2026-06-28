import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '../auth/WorkspaceContext'
import { Runs } from './Runs'

const workspace = {
  id: 'workspace-1',
  slug: 'ai-capability-center',
  name: 'AI 能力中心',
}

const run = {
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

describe('Runs', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    window.history.pushState({}, '', '/')
  })

  it('renders persisted run metrics, output and node attempts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ ...run, status: '宸插畬鎴?' }]), { status: 200 }),
    ))

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

  it('loads and renders run operation history', async () => {
    const events = [{
      id: 'event-1',
      action: 'run.batch_rerun',
      targetType: 'run',
      targetId: 'run-1',
      outcome: 'success',
      reason: 'batch rerun from run center',
      actorId: 'user-1',
      requestId: 'req-batch-rerun',
      traceId: 'trace-run-operation',
      createdAt: '2026-06-28T08:00:00Z',
      metadata: { sourceRunId: 'run-1', newRunId: 'run-2' },
    }]
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      if (url === `/api/workspaces/${workspace.id}/runs`) {
        return Promise.resolve(new Response(JSON.stringify([run]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/runs/run-1/operation-history`) {
        return Promise.resolve(new Response(JSON.stringify(events), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <WorkspaceProvider workspace={workspace}>
        <Runs />
      </WorkspaceProvider>,
    )

    expect(await screen.findByText('\u64cd\u4f5c\u5386\u53f2')).toBeInTheDocument()
    expect(await screen.findByText('\u6279\u91cf\u91cd\u8dd1')).toBeInTheDocument()
    expect(screen.getByText('req-batch-rerun')).toBeInTheDocument()
    expect(screen.getByText('newRunId: run-2')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '\u67e5\u770b\u5ba1\u8ba1' })).toHaveAttribute(
      'href',
      '/w/ai-capability-center/settings/audit?traceId=trace-run-operation',
    )
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
      if (url === `/api/workspaces/${workspace.id}/runs/run-deep-link/operation-history`) {
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
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/workspaces/${workspace.id}/runs/run-deep-link/operation-history`,
      expect.objectContaining({ credentials: 'same-origin' }),
    )
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
      if (url === `/api/workspaces/${workspace.id}/runs/run-1/operation-history`) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/runs/run-second/operation-history`) {
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

    expect((await screen.findAllByText('run-1')).length).toBeGreaterThanOrEqual(1)
    await user.click(screen.getByRole('button', { name: /Second workflow run/ }))

    expect(await screen.findByRole('heading', { name: 'Second workflow run' })).toBeInTheDocument()
    expect(window.location.search).toBe('?tab=history&runId=run-second')
  })

  it('links a waiting workflow run to the human review queue', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ ...run, status: '需介入', currentNode: '人工审核' }]), { status: 200 }),
    ))

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

  it('reruns a failed workflow run and selects the new run', async () => {
    const user = userEvent.setup()
    const failedRun = {
      ...run,
      id: 'run-failed',
      status: '失败',
      input: '复用这次输入',
      output: '',
      error: 'Agent 执行失败，请稍后重试',
    }
    const rerun = {
      ...run,
      id: 'run-rerun',
      status: '\u5df2\u5b8c\u6210',
      input: '复用这次输入',
      output: '\u91cd\u65b0\u8fd0\u884c\u5df2\u7ecf\u5b8c\u6210\u3002',
      error: '',
      startedAt: '2026-06-24T08:05:00Z',
      nodes: [{ ...run.nodes[0], output: '\u91cd\u65b0\u8fd0\u884c\u5df2\u7ecf\u5b8c\u6210\u3002' }],
    }
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      if (url === `/api/workspaces/${workspace.id}/runs`) {
        return Promise.resolve(new Response(JSON.stringify([failedRun]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/runs/run-failed/rerun`) {
        return Promise.resolve(new Response(JSON.stringify(rerun), { status: 201 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <WorkspaceProvider workspace={workspace}>
        <Runs />
      </WorkspaceProvider>,
    )

    expect(await screen.findByText('Agent 执行失败，请稍后重试')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '\u91cd\u65b0\u8fd0\u884c' }))

    expect(await screen.findByText('\u91cd\u65b0\u8fd0\u884c\u5df2\u521b\u5efa')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '新品研究流程' })).toBeInTheDocument()
    expect(screen.getAllByText('\u91cd\u65b0\u8fd0\u884c\u5df2\u7ecf\u5b8c\u6210\u3002')).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/workspaces/${workspace.id}/runs/run-failed/rerun`,
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('reruns a failed workflow run with an edited input', async () => {
    const user = userEvent.setup()
    const failedRun = {
      ...run,
      id: 'run-failed',
      status: '澶辫触',
      input: 'Original workflow input',
      output: '',
      error: 'Agent 鎵ц澶辫触锛岃绋嶅悗閲嶈瘯',
    }
    const rerun = {
      ...run,
      id: 'run-rerun',
      status: '\u5df2\u5b8c\u6210',
      input: 'Corrected workflow input',
      output: 'Rerun output created from corrected input.',
      error: '',
      startedAt: '2026-06-24T08:05:00Z',
      nodes: [{ ...run.nodes[0], output: 'Rerun output created from corrected input.' }],
    }
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      if (url === `/api/workspaces/${workspace.id}/runs`) {
        return Promise.resolve(new Response(JSON.stringify([failedRun]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/runs/run-failed/rerun`) {
        return Promise.resolve(new Response(JSON.stringify(rerun), { status: 201 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <WorkspaceProvider workspace={workspace}>
        <Runs />
      </WorkspaceProvider>,
    )

    expect(await screen.findByRole('heading', { name: '\u65b0\u54c1\u7814\u7a76\u6d41\u7a0b' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '\u7f16\u8f91\u8f93\u5165\u91cd\u8dd1' }))
    const inputBox = screen.getByLabelText('\u91cd\u8dd1\u8f93\u5165')
    expect(inputBox).toHaveValue('Original workflow input')
    await user.clear(inputBox)
    await user.type(inputBox, 'Corrected workflow input')
    await user.click(screen.getByRole('button', { name: '\u786e\u8ba4\u91cd\u8dd1' }))

    expect(await screen.findByText('\u91cd\u65b0\u8fd0\u884c\u5df2\u521b\u5efa')).toBeInTheDocument()
    expect(screen.getAllByText('Rerun output created from corrected input.')).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/workspaces/${workspace.id}/runs/run-failed/rerun`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ input: 'Corrected workflow input' }),
      }),
    )
  })

  it('batch reruns selected failed workflow runs and selects the first created run', async () => {
    const user = userEvent.setup()
    const firstFailedRun = {
      ...run,
      id: 'run-failed-a',
      name: 'Batch source A',
      status: '\u5931\u8d25',
      input: 'Batch input A',
      output: '',
      error: 'First source failed',
    }
    const secondFailedRun = {
      ...run,
      id: 'run-failed-b',
      name: 'Batch source B',
      status: '\u5931\u8d25',
      input: 'Batch input B',
      output: '',
      error: 'Second source failed',
    }
    const firstCreatedRun = {
      ...firstFailedRun,
      id: 'run-created-a',
      status: '\u5df2\u5b8c\u6210',
      output: 'Batch output A',
      error: '',
      nodes: [{ ...run.nodes[0], output: 'Batch output A' }],
    }
    const secondCreatedRun = {
      ...secondFailedRun,
      id: 'run-created-b',
      status: '\u5df2\u5b8c\u6210',
      output: 'Batch output B',
      error: '',
      nodes: [{ ...run.nodes[0], output: 'Batch output B' }],
    }
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      if (url === `/api/workspaces/${workspace.id}/runs`) {
        return Promise.resolve(new Response(JSON.stringify([firstFailedRun, secondFailedRun]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/runs/batch-rerun`) {
        return Promise.resolve(new Response(JSON.stringify({
          createdRuns: [firstCreatedRun, secondCreatedRun],
          failures: [],
        }), { status: 201 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <WorkspaceProvider workspace={workspace}>
        <Runs />
      </WorkspaceProvider>,
    )

    expect(await screen.findByRole('heading', { name: 'Batch source A' })).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: '选择运行 run-failed-a' }))
    await user.click(screen.getByRole('checkbox', { name: '选择运行 run-failed-b' }))
    await user.click(screen.getByRole('button', { name: '批量重跑' }))

    expect(await screen.findByText('已批量重跑 2 条')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Batch source A' })).toBeInTheDocument()
    expect(screen.getAllByText('Batch output A')).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/workspaces/${workspace.id}/runs/batch-rerun`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ runIds: ['run-failed-a', 'run-failed-b'] }),
      }),
    )
  })

  it('shows per-run failures after a partial batch rerun', async () => {
    const user = userEvent.setup()
    const firstFailedRun = {
      ...run,
      id: 'run-failed-a',
      name: 'Partial batch source A',
      status: '\u5931\u8d25',
      input: 'Partial input A',
      output: '',
      error: 'First source failed',
    }
    const secondFailedRun = {
      ...run,
      id: 'run-failed-b',
      name: 'Partial batch source B',
      status: '\u5931\u8d25',
      input: 'Partial input B',
      output: '',
      error: 'Second source failed',
    }
    const firstCreatedRun = {
      ...firstFailedRun,
      id: 'run-created-a',
      status: '\u5df2\u5b8c\u6210',
      output: 'Partial batch output A',
      error: '',
      nodes: [{ ...run.nodes[0], output: 'Partial batch output A' }],
    }
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      if (url === `/api/workspaces/${workspace.id}/runs`) {
        return Promise.resolve(new Response(JSON.stringify([firstFailedRun, secondFailedRun]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/runs/batch-rerun`) {
        return Promise.resolve(new Response(JSON.stringify({
          createdRuns: [firstCreatedRun],
          failures: [{ sourceRunId: 'run-failed-b', reason: 'Provider temporarily unavailable' }],
        }), { status: 201 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <WorkspaceProvider workspace={workspace}>
        <Runs />
      </WorkspaceProvider>,
    )

    expect(await screen.findByRole('heading', { name: 'Partial batch source A' })).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: '\u9009\u62e9\u8fd0\u884c run-failed-a' }))
    await user.click(screen.getByRole('checkbox', { name: '\u9009\u62e9\u8fd0\u884c run-failed-b' }))
    await user.click(screen.getByRole('button', { name: '\u6279\u91cf\u91cd\u8dd1' }))

    expect(await screen.findByText('Provider temporarily unavailable')).toBeInTheDocument()
    expect(screen.getByText('\u672a\u5b8c\u6210\u7684\u6279\u91cf\u9879')).toBeInTheDocument()
    expect(screen.getAllByText('run-failed-b').length).toBeGreaterThanOrEqual(2)
  })

  it('batch resumes selected failed workflow runs and updates the original runs', async () => {
    const user = userEvent.setup()
    const firstFailedRun = {
      ...run,
      id: 'run-failed-a',
      name: 'Batch resume source A',
      status: '\u5931\u8d25',
      input: 'Batch resume input A',
      output: '',
      error: 'First source failed',
    }
    const secondFailedRun = {
      ...run,
      id: 'run-failed-b',
      name: 'Batch resume source B',
      status: '\u5931\u8d25',
      input: 'Batch resume input B',
      output: '',
      error: 'Second source failed',
    }
    const firstResumedRun = {
      ...firstFailedRun,
      status: '\u5df2\u5b8c\u6210',
      output: 'Batch resume output A',
      error: '',
      nodes: [{ ...run.nodes[0], output: 'Batch resume output A' }],
    }
    const secondResumedRun = {
      ...secondFailedRun,
      status: '\u5df2\u5b8c\u6210',
      output: 'Batch resume output B',
      error: '',
      nodes: [{ ...run.nodes[0], output: 'Batch resume output B' }],
    }
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      if (url === `/api/workspaces/${workspace.id}/runs`) {
        return Promise.resolve(new Response(JSON.stringify([firstFailedRun, secondFailedRun]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/runs/batch-resume-from-failed-node`) {
        return Promise.resolve(new Response(JSON.stringify({
          resumedRuns: [firstResumedRun, secondResumedRun],
          failures: [],
        }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <WorkspaceProvider workspace={workspace}>
        <Runs />
      </WorkspaceProvider>,
    )

    expect(await screen.findByRole('heading', { name: 'Batch resume source A' })).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: '\u9009\u62e9\u8fd0\u884c run-failed-a' }))
    await user.click(screen.getByRole('checkbox', { name: '\u9009\u62e9\u8fd0\u884c run-failed-b' }))
    await user.click(screen.getByRole('button', { name: '\u6279\u91cf\u6062\u590d' }))

    expect(await screen.findByText('\u5df2\u6279\u91cf\u6062\u590d 2 \u6761')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Batch resume source A' })).toBeInTheDocument()
    expect(screen.getAllByText('Batch resume output A')).toHaveLength(2)
    expect(screen.queryByText('First source failed')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/workspaces/${workspace.id}/runs/batch-resume-from-failed-node`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ runIds: ['run-failed-a', 'run-failed-b'] }),
      }),
    )
  })

  it('shows per-run failures after a partial batch resume', async () => {
    const user = userEvent.setup()
    const firstFailedRun = {
      ...run,
      id: 'run-failed-a',
      name: 'Partial resume source A',
      status: '\u5931\u8d25',
      input: 'Partial resume input A',
      output: '',
      error: 'First source failed',
    }
    const secondFailedRun = {
      ...run,
      id: 'run-failed-b',
      name: 'Partial resume source B',
      status: '\u5931\u8d25',
      input: 'Partial resume input B',
      output: '',
      error: 'Second source failed',
    }
    const firstResumedRun = {
      ...firstFailedRun,
      status: '\u5df2\u5b8c\u6210',
      output: 'Partial resume output A',
      error: '',
      nodes: [{ ...run.nodes[0], output: 'Partial resume output A' }],
    }
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      if (url === `/api/workspaces/${workspace.id}/runs`) {
        return Promise.resolve(new Response(JSON.stringify([firstFailedRun, secondFailedRun]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/runs/batch-resume-from-failed-node`) {
        return Promise.resolve(new Response(JSON.stringify({
          resumedRuns: [firstResumedRun],
          failures: [{ sourceRunId: 'run-failed-b', reason: 'Run has no resumable failed node' }],
        }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <WorkspaceProvider workspace={workspace}>
        <Runs />
      </WorkspaceProvider>,
    )

    expect(await screen.findByRole('heading', { name: 'Partial resume source A' })).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: '\u9009\u62e9\u8fd0\u884c run-failed-a' }))
    await user.click(screen.getByRole('checkbox', { name: '\u9009\u62e9\u8fd0\u884c run-failed-b' }))
    await user.click(screen.getByRole('button', { name: '\u6279\u91cf\u6062\u590d' }))

    expect(await screen.findByText('Run has no resumable failed node')).toBeInTheDocument()
    expect(screen.getByText('\u672a\u5b8c\u6210\u7684\u6279\u91cf\u9879')).toBeInTheDocument()
    expect(screen.getAllByText('run-failed-b').length).toBeGreaterThanOrEqual(2)
  })

  it('resumes a failed workflow run from the failed node', async () => {
    const user = userEvent.setup()
    const failedRun = {
      ...run,
      id: 'run-failed',
      status: '失败',
      output: '',
      error: 'Agent 执行失败，请稍后重试',
    }
    const resumed = {
      ...failedRun,
      status: '已完成',
      output: '从失败点恢复后的结果。',
      error: '',
      nodes: [
        ...run.nodes,
        { ...run.nodes[0], id: 'node-recovered', output: '从失败点恢复后的结果。' },
      ],
    }
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      if (url === `/api/workspaces/${workspace.id}/runs`) {
        return Promise.resolve(new Response(JSON.stringify([failedRun]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/runs/run-failed/resume-from-failed-node`) {
        return Promise.resolve(new Response(JSON.stringify(resumed), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <WorkspaceProvider workspace={workspace}>
        <Runs />
      </WorkspaceProvider>,
    )

    expect(await screen.findByText('Agent 执行失败，请稍后重试')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '从失败点恢复' }))

    expect(await screen.findByText('已从失败点恢复')).toBeInTheDocument()
    expect(screen.getAllByText('从失败点恢复后的结果。')).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/workspaces/${workspace.id}/runs/run-failed/resume-from-failed-node`,
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
