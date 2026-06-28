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
})
