import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DragEventHandler, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '../auth/WorkspaceContext'
import { Workflows } from './Workflows'

const workspace = {
  id: 'workspace-1',
  slug: 'ai-capability-center',
  name: 'AI 能力中心',
}

const flowMock = vi.hoisted(() => ({
  screenToFlowPosition: vi.fn(),
}))

vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual<typeof import('@xyflow/react')>('@xyflow/react')
  return {
    ...actual,
    ReactFlow: ({
      nodes,
      edges,
      onConnect,
      onNodeClick,
      onDrop,
      onDragOver,
      onInit,
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
      onDrop?: DragEventHandler<HTMLDivElement>
      onDragOver?: DragEventHandler<HTMLDivElement>
      onInit?: (instance: { screenToFlowPosition: (position: { x: number; y: number }) => { x: number; y: number } }) => void
      children?: ReactNode
    }) => {
      onInit?.({
        screenToFlowPosition: flowMock.screenToFlowPosition,
      })
      return (
        <div
          data-testid="flow-drop-zone"
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
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
      )
    },
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
  beforeEach(() => {
    flowMock.screenToFlowPosition.mockReturnValue({ x: 420, y: 270 })
  })

  afterEach(() => {
    flowMock.screenToFlowPosition.mockReset()
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
      status: '宸插畬鎴?',
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
    expect(screen.getByText('已完成')).toBeInTheDocument()
    expect(screen.queryByText('宸插畬鎴?')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(`/api/workspaces/${workspace.id}/workflows/workflow-1/runs`, expect.objectContaining({
      method: 'POST',
    }))
  })

  it('guides the user to Reviews when a workflow pauses for human review', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    const waitingRun = {
      id: 'run-human-1',
      kind: 'workflow',
      name: workflow.name,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      agentId: null,
      agentVersion: null,
      status: '需介入',
      input: '生成新品定义',
      output: 'Agent 产出已暂停，等待人工审核。',
      score: 82,
      model: 'configured-model',
      promptTokens: 12,
      completionTokens: 8,
      totalTokens: 20,
      costUsd: 0.001,
      durationMs: 1200,
      currentNode: '人工审核',
      error: '',
      startedAt: '2026-06-24T08:00:00Z',
      completedAt: null,
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
        return Promise.resolve(new Response(JSON.stringify(waitingRun), { status: 201 }))
      }
      return Promise.resolve(new Response('{}', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWorkflows()

    await user.click(await screen.findByRole('button', { name: '运行工作流' }))
    await user.type(screen.getByLabelText('运行输入'), '生成新品定义')
    await user.click(screen.getByRole('button', { name: '开始运行' }))

    expect(await screen.findByText('工作流已暂停在人工审核节点')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '去人工审核处理' })).toHaveAttribute(
      'href',
      '/w/ai-capability-center/reviews',
    )
    expect(screen.getByRole('link', { name: '查看运行记录' })).toHaveAttribute(
      'href',
      '/w/ai-capability-center/runs',
    )
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

  it('explains that direct reviewer options only include active reviewer qualifications', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    const reviewers = [
      { id: 'reviewer-admin', name: '管理员', role: '产品审核人', isExpert: false, isActive: true },
      { id: 'reviewer-inactive', name: '未授权成员', role: '内容审核人', isExpert: false, isActive: false },
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
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url.endsWith('/versions')) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWorkflows()

    await user.click(await screen.findByTestId('flow-node-human-1'))
    await user.selectOptions(screen.getByLabelText('分配方式'), 'direct_reviewer')

    expect(screen.getByRole('option', { name: '管理员 · 产品审核人' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '未授权成员 · 内容审核人' })).not.toBeInTheDocument()
    expect(screen.getByText('这里只显示已授予 Reviewer 资格且仍启用的成员。没看到的人，请先到成员与权限绑定 Reviewer 资格。')).toBeInTheDocument()
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

  it('drops a palette node onto the canvas and saves it at the drop position', async () => {
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
      if (url === `/api/workspaces/${workspace.id}/workflows` && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ ...workflow, id: 'workflow-created' }), { status: 201 }))
      }
      return Promise.resolve(new Response('{}', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWorkflows()

    const humanPaletteItem = await screen.findByRole('button', { name: '添加人工审核节点' })
    const dropZone = screen.getByTestId('flow-drop-zone')
    const dragData = new Map<string, string>()
    const dataTransfer = {
      setData: (key: string, value: string) => dragData.set(key, value),
      getData: (key: string) => dragData.get(key) ?? '',
      effectAllowed: '',
      dropEffect: '',
      types: ['application/arc-one-node'],
    }

    fireEvent.dragStart(humanPaletteItem, { dataTransfer })
    const dragOverEvent = createEvent.dragOver(dropZone, { dataTransfer })
    Object.defineProperties(dragOverEvent, {
      clientX: { value: 520 },
      clientY: { value: 320 },
    })
    const dropEvent = createEvent.drop(dropZone, { dataTransfer })
    Object.defineProperties(dropEvent, {
      clientX: { value: 520 },
      clientY: { value: 320 },
    })
    fireEvent(dropZone, dragOverEvent)
    fireEvent(dropZone, dropEvent)

    expect(await screen.findByTestId(/flow-node-human-/)).toHaveTextContent('人工审核')

    await user.click(screen.getByRole('button', { name: '保存草稿' }))

    const postCall = fetchMock.mock.calls.find(([url, init]) => (
      url === `/api/workspaces/${workspace.id}/workflows` && init?.method === 'POST'
    ))
    const body = JSON.parse(postCall?.[1]?.body as string)
    expect(body.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'human',
        position: { x: 420, y: 270 },
        data: expect.objectContaining({ label: '人工审核' }),
      }),
    ]))
  })

  it('falls back to the canvas-relative drop position when React Flow rejects conversion', async () => {
    const user = userEvent.setup()
    flowMock.screenToFlowPosition.mockImplementation(() => {
      throw new Error('missing viewport')
    })
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
      if (url === `/api/workspaces/${workspace.id}/workflows` && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ ...workflow, id: 'workflow-created' }), { status: 201 }))
      }
      return Promise.resolve(new Response('{}', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWorkflows()

    await screen.findByTestId('flow-drop-zone')
    const humanPaletteItem = document.querySelectorAll<HTMLButtonElement>('.palette-item')[6]
    const dropZone = screen.getByTestId('flow-drop-zone')
    Object.defineProperty(dropZone, 'getBoundingClientRect', {
      value: () => ({
        x: 20,
        y: 30,
        left: 20,
        top: 30,
        right: 820,
        bottom: 630,
        width: 800,
        height: 600,
        toJSON: () => {},
      }),
    })
    const dragData = new Map<string, string>()
    const dataTransfer = {
      setData: (key: string, value: string) => dragData.set(key, value),
      getData: (key: string) => dragData.get(key) ?? '',
      effectAllowed: '',
      dropEffect: '',
      types: ['application/arc-one-node'],
    }

    fireEvent.dragStart(humanPaletteItem, { dataTransfer })
    const dragOverEvent = createEvent.dragOver(dropZone, { dataTransfer })
    Object.defineProperties(dragOverEvent, {
      clientX: { value: 520 },
      clientY: { value: 320 },
    })
    const dropEvent = createEvent.drop(dropZone, { dataTransfer })
    Object.defineProperties(dropEvent, {
      clientX: { value: 520 },
      clientY: { value: 320 },
    })
    fireEvent(dropZone, dragOverEvent)
    fireEvent(dropZone, dropEvent)

    expect(await screen.findByTestId(/flow-node-human-/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '保存草稿' }))

    const postCall = fetchMock.mock.calls.find(([url, init]) => (
      url === `/api/workspaces/${workspace.id}/workflows` && init?.method === 'POST'
    ))
    const body = JSON.parse(postCall?.[1]?.body as string)
    expect(body.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'human',
        position: { x: 500, y: 290 },
      }),
    ]))
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
