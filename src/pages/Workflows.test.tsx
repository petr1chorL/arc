import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Workflows } from './Workflows'

vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual<typeof import('@xyflow/react')>('@xyflow/react')
  return {
    ...actual,
    ReactFlow: ({
      nodes,
      onNodeClick,
      children,
    }: {
      nodes: Array<{ id: string; data: Record<string, unknown> }>
      onNodeClick?: (event: unknown, node: unknown) => void
      children?: React.ReactNode
    }) => (
      <div>
        {nodes.map((node) => (
          <button
            data-testid={`flow-node-${node.id}`}
            key={node.id}
            onClick={(event) => onNodeClick?.(event, node)}
          >
            {String(node.data.label)}
          </button>
        ))}
        {children}
      </div>
    ),
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
  }
})

const workflow = {
  id: 'workflow-1',
  name: '新品研究流程',
  status: '草稿',
  version: 'v1.0.0',
  nodes: [
    {
      id: 'human-1',
      type: 'human',
      position: { x: 300, y: 200 },
      data: {
        label: '人工审核',
        subtitle: '待配置',
        assignmentType: 'group_claim',
        reviewPolicy: 'any_one',
        requiredApprovals: 1,
        dueMinutes: 60,
        escalationMinutes: 120,
      },
    },
  ],
  edges: [],
  createdAt: '2026-06-24T07:00:00Z',
  updatedAt: '2026-06-24T07:00:00Z',
}

describe('Workflows', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('runs the selected published workflow with user input', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    const run = {
      id: 'run-1',
      kind: 'workflow',
      name: workflow.name,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      agentId: null,
      agentVersion: null,
      status: '已完成',
      input: '分析新品机会',
      output: '工作流真实执行完成并生成了结构化结果。',
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
      nodes: [],
    }
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/workflows') {
        return Promise.resolve(new Response(JSON.stringify([workflow]), { status: 200 }))
      }
      if (url === '/api/agents') {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url.endsWith('/versions')) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url.endsWith('/runs')) {
        return Promise.resolve(new Response(JSON.stringify(run), { status: 201 }))
      }
      return Promise.resolve(new Response('{}', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<Workflows />)

    await user.click(await screen.findByRole('button', { name: '运行工作流' }))
    await user.type(screen.getByLabelText('运行输入'), '分析新品机会')
    await user.click(screen.getByRole('button', { name: '开始运行' }))

    expect(await screen.findByText('工作流真实执行完成并生成了结构化结果。')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/workflows/workflow-1/runs', expect.objectContaining({
      method: 'POST',
    }))
  })

  it('serializes human assignment signoff and sla settings', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
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
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/workflows' && !init) {
        return Promise.resolve(new Response(JSON.stringify([workflow]), { status: 200 }))
      }
      if (url === '/api/agents') {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url === '/api/reviewers') {
        return Promise.resolve(new Response(JSON.stringify(reviewers), { status: 200 }))
      }
      if (url === '/api/review-groups') {
        return Promise.resolve(new Response(JSON.stringify(groups), { status: 200 }))
      }
      if (url.endsWith('/versions')) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url === '/api/workflows/workflow-1' && init?.method === 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify(workflow), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<Workflows />)

    await user.click(await screen.findByTestId('flow-node-human-1'))
    await user.selectOptions(screen.getByLabelText('分配方式'), 'round_robin')
    await user.selectOptions(screen.getByLabelText('审核组'), 'group-product')
    await user.selectOptions(screen.getByLabelText('会签策略'), 'threshold')
    await user.clear(screen.getByLabelText('通过人数'))
    await user.type(screen.getByLabelText('通过人数'), '2')
    await user.clear(screen.getByLabelText('审核时限（分钟）'))
    await user.type(screen.getByLabelText('审核时限（分钟）'), '90')
    await user.clear(screen.getByLabelText('升级时间（分钟）'))
    await user.type(screen.getByLabelText('升级时间（分钟）'), '180')
    await user.selectOptions(screen.getByLabelText('升级审核组'), 'group-escalation')
    await user.click(screen.getByRole('button', { name: '保存草稿' }))

    const patchCall = fetchMock.mock.calls.find(([url, init]) => (
      url === '/api/workflows/workflow-1' && init?.method === 'PATCH'
    ))
    const body = JSON.parse(patchCall?.[1]?.body as string)
    expect(body.nodes[0].data).toEqual(expect.objectContaining({
      assignmentType: 'round_robin',
      groupId: 'group-product',
      reviewPolicy: 'threshold',
      requiredApprovals: 2,
      dueMinutes: 90,
      escalationMinutes: 180,
      escalationGroupId: 'group-escalation',
    }))
  })
})
