import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '../auth/WorkspaceContext'
import { Workflows } from './Workflows'

const workspace = {
  id: 'workspace-1',
  slug: 'ai-capability-center',
  name: 'AI 能力中心',
}

vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual<typeof import('@xyflow/react')>('@xyflow/react')
  return {
    ...actual,
    ReactFlow: ({
      nodes,
      edges,
      onConnect,
      onNodeClick,
      children,
    }: {
      nodes: Array<{ id: string; data: Record<string, unknown> }>
      edges: Array<{ id: string; source: string; target: string }>
      onConnect?: (connection: {
        source: string
        target: string
        sourceHandle: null
        targetHandle: null
      }) => void
      onNodeClick?: (event: unknown, node: unknown) => void
      children?: ReactNode
    }) => (
      <div>
        <output data-testid="edge-count">{edges.length}</output>
        {nodes.map((node) => (
          <button
            data-testid={`flow-node-${node.id}`}
            key={node.id}
            onClick={(event) => onNodeClick?.(event, node)}
          >
            {String(node.data.label)}
          </button>
        ))}
        {nodes.length >= 2 && (
          <button
            data-testid="connect-first-two"
            onClick={() => onConnect?.({
              source: nodes[0].id,
              target: nodes[1].id,
              sourceHandle: null,
              targetHandle: null,
            })}
          >
            模拟连接
          </button>
        )}
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

function renderWorkflows() {
  return render(
    <WorkspaceProvider workspace={workspace}>
      <Workflows />
    </WorkspaceProvider>,
  )
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
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === `/api/workspaces/${workspace.id}/workflows` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([workflow]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/agents` && !init?.method) {
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

    renderWorkflows()

    await user.click(await screen.findByRole('button', { name: '运行工作流' }))
    await user.type(screen.getByLabelText('运行输入'), '分析新品机会')
    await user.click(screen.getByRole('button', { name: '开始运行' }))

    expect(await screen.findByText('工作流真实执行完成并生成了结构化结果。')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(`/api/workspaces/${workspace.id}/workflows/workflow-1/runs`, expect.objectContaining({
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
      if (url === `/api/workspaces/${workspace.id}/workflows` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([workflow]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/agents` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/reviewers` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify(reviewers), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/review-groups` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify(groups), { status: 200 }))
      }
      if (url.endsWith('/versions')) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/workflows/workflow-1` && init?.method === 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify(workflow), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWorkflows()

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
      url === `/api/workspaces/${workspace.id}/workflows/workflow-1` && init?.method === 'PATCH'
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

  it('offers start and end nodes in the node palette', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === `/api/workspaces/${workspace.id}/workflows` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/agents` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (
        url === `/api/workspaces/${workspace.id}/reviewers`
        || url === `/api/workspaces/${workspace.id}/review-groups`
      ) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWorkflows()

    const triggerButton = await screen.findByRole('button', {
      name: '添加手动触发节点',
    })
    const endButton = screen.getByRole('button', {
      name: '添加流程完成节点',
    })
    expect(screen.getAllByText('手动触发')).toHaveLength(2)
    expect(screen.getAllByText('流程完成')).toHaveLength(2)

    await user.click(triggerButton)
    await user.click(endButton)

    expect(screen.getAllByText('手动触发')).toHaveLength(3)
    expect(screen.getAllByText('流程完成')).toHaveLength(3)
  })

  it('restores the default connected graph when starting a new workflow', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === `/api/workspaces/${workspace.id}/workflows` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([workflow]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/agents` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (
        url === `/api/workspaces/${workspace.id}/reviewers`
        || url === `/api/workspaces/${workspace.id}/review-groups`
      ) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url.endsWith('/versions')) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWorkflows()

    await screen.findByTestId('flow-node-human-1')
    expect(screen.getByTestId('edge-count')).toHaveTextContent('0')

    await user.click(screen.getByRole('button', { name: '新建' }))

    expect(screen.getByTestId('flow-node-start')).toHaveTextContent('手动触发')
    expect(screen.getByTestId('flow-node-agent')).toHaveTextContent('选择执行 Agent')
    expect(screen.getByTestId('flow-node-end')).toHaveTextContent('流程完成')
    expect(screen.getByTestId('edge-count')).toHaveTextContent('2')
  })

  it('persists a connection made between two nodes', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    const disconnectedWorkflow = {
      ...workflow,
      nodes: [
        {
          id: 'start',
          type: 'trigger',
          position: { x: 0, y: 0 },
          data: { label: '手动触发', subtitle: '启动工作流' },
        },
        {
          id: 'end',
          type: 'end',
          position: { x: 300, y: 0 },
          data: { label: '流程完成', subtitle: '结束节点' },
        },
      ],
      edges: [],
    }
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === `/api/workspaces/${workspace.id}/workflows` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([disconnectedWorkflow]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/agents` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (
        url === `/api/workspaces/${workspace.id}/reviewers`
        || url === `/api/workspaces/${workspace.id}/review-groups`
      ) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url.endsWith('/versions')) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/workflows/workflow-1` && init?.method === 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify(disconnectedWorkflow), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWorkflows()

    await screen.findByTestId('flow-node-start')
    await user.click(screen.getByTestId('connect-first-two'))
    await user.click(screen.getByRole('button', { name: '保存草稿' }))

    const patchCall = fetchMock.mock.calls.find(([url, init]) => (
      url === `/api/workspaces/${workspace.id}/workflows/workflow-1` && init?.method === 'PATCH'
    ))
    const body = JSON.parse(patchCall?.[1]?.body as string)
    expect(body.edges).toEqual([
      expect.objectContaining({ source: 'start', target: 'end' }),
    ])
  })
})
