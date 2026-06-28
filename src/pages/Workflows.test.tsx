import { createEvent, fireEvent, render, screen, within } from '@testing-library/react'
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
      onEdgeClick,
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
      onEdgeClick?: (event: unknown, edge: { id: string; source: string; target: string }) => void
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
          {edges.map((edge) => (
            <button
              data-testid={`flow-edge-${edge.id}`}
              key={edge.id}
              onClick={(event) => onEdgeClick?.(event, edge)}
            >
              {edge.source} → {edge.target}
            </button>
          ))}
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
  inputSchema: { type: 'object', properties: {} },
  outputSchema: { type: 'object', properties: {} },
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

  it('edits workflow input and output schemas and saves them with the draft', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    const savedWorkflow = {
      ...workflow,
      inputSchema: {
        type: 'object',
        required: ['asin'],
        properties: { asin: { type: 'string' } },
      },
      outputSchema: {
        type: 'object',
        required: ['summary'],
        properties: { summary: { type: 'string' } },
      },
    }
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
      if (url === `/api/workspaces/${workspace.id}/workflows/workflow-1` && init?.method === 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify(savedWorkflow), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWorkflows()

    const inputSchema = await screen.findByLabelText('工作流输入 Schema')
    fireEvent.change(inputSchema, { target: { value: JSON.stringify(savedWorkflow.inputSchema, null, 2) } })
    const outputSchema = screen.getByLabelText('工作流输出 Schema')
    fireEvent.change(outputSchema, { target: { value: JSON.stringify(savedWorkflow.outputSchema, null, 2) } })
    await user.click(screen.getByRole('button', { name: '保存草稿' }))

    const patchCall = fetchMock.mock.calls.find(([url, init]) => (
      url === `/api/workspaces/${workspace.id}/workflows/workflow-1` && init?.method === 'PATCH'
    ))
    const body = JSON.parse(patchCall?.[1]?.body as string)
    expect(body.inputSchema).toEqual(savedWorkflow.inputSchema)
    expect(body.outputSchema).toEqual(savedWorkflow.outputSchema)
  })

  it('blocks saving when workflow schema text is not a JSON object', async () => {
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
      if (url === `/api/workspaces/${workspace.id}/workflows/workflow-1` && init?.method === 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify(workflow), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWorkflows()

    const inputSchema = await screen.findByLabelText('工作流输入 Schema')
    fireEvent.change(inputSchema, { target: { value: '[]' } })
    await user.click(screen.getByRole('button', { name: '保存草稿' }))

    expect(await screen.findByText('工作流输入 Schema 必须是 JSON 对象')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url, init]) => (
      url === `/api/workspaces/${workspace.id}/workflows/workflow-1` && init?.method === 'PATCH'
    ))).toBe(false)
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

  it('duplicates the selected node without copying edges and saves the duplicate', async () => {
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
      if (url === `/api/workspaces/${workspace.id}/workflows/workflow-1` && init?.method === 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify(workflow), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWorkflows()

    await user.click(await screen.findByTestId('flow-node-human-1'))
    await user.click(screen.getByRole('button', { name: '复制节点' }))

    expect(screen.getAllByRole('button', { name: '人工审核' })).toHaveLength(2)
    expect(screen.getByTestId('edge-count')).toHaveTextContent('0')

    await user.click(screen.getByRole('button', { name: '保存草稿' }))

    const patchCall = fetchMock.mock.calls.find(([url, init]) => (
      url === `/api/workspaces/${workspace.id}/workflows/workflow-1` && init?.method === 'PATCH'
    ))
    const body = JSON.parse(patchCall?.[1]?.body as string)
    const humanNodes = body.nodes.filter((node: { type: string }) => node.type === 'human')
    expect(humanNodes).toHaveLength(2)
    expect(humanNodes[1]).toEqual(expect.objectContaining({
      type: 'human',
      position: { x: 340, y: 240 },
      data: expect.objectContaining({
        assignmentType: 'group_claim',
        dueMinutes: 60,
      }),
    }))
    expect(body.edges).toEqual([])
  })

  it('explains connected edge impact and requires confirmation before deleting a node', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    const connectedWorkflow = {
      ...workflow,
      nodes: [
        {
          id: 'start',
          type: 'trigger',
          position: { x: 0, y: 0 },
          data: { label: '手动触发', subtitle: '启动工作流' },
        },
        {
          id: 'agent',
          type: 'agent',
          position: { x: 300, y: 0 },
          data: { label: '选择执行 Agent', subtitle: '尚未绑定发布版本' },
        },
        {
          id: 'end',
          type: 'end',
          position: { x: 600, y: 0 },
          data: { label: '流程完成', subtitle: '结束节点' },
        },
      ],
      edges: [
        { id: 'start-agent', source: 'start', target: 'agent' },
        { id: 'agent-end', source: 'agent', target: 'end' },
      ],
    }
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === `/api/workspaces/${workspace.id}/workflows` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([connectedWorkflow]), { status: 200 }))
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
        return Promise.resolve(new Response(JSON.stringify(connectedWorkflow), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWorkflows()

    await user.click(await screen.findByTestId('flow-node-agent'))

    expect(screen.getByText('删除影响')).toBeInTheDocument()
    expect(screen.getByText('入边 1')).toBeInTheDocument()
    expect(screen.getByText('出边 1')).toBeInTheDocument()
    expect(screen.getByText('共影响 2 条连线')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '删除节点' }))

    expect(screen.getByText('确认删除该节点？')).toBeInTheDocument()
    expect(screen.getByText('将同时移除 2 条关联连线。')).toBeInTheDocument()
    expect(screen.getByTestId('flow-node-agent')).toBeInTheDocument()
    expect(screen.getByTestId('edge-count')).toHaveTextContent('2')

    await user.click(screen.getByRole('button', { name: '取消删除' }))

    expect(screen.queryByText('确认删除该节点？')).not.toBeInTheDocument()
    expect(screen.getByTestId('flow-node-agent')).toBeInTheDocument()
    expect(screen.getByTestId('edge-count')).toHaveTextContent('2')

    await user.click(screen.getByRole('button', { name: '删除节点' }))
    await user.click(screen.getByRole('button', { name: '确认删除节点' }))

    expect(screen.queryByTestId('flow-node-agent')).not.toBeInTheDocument()
    expect(screen.getByTestId('flow-node-start')).toBeInTheDocument()
    expect(screen.getByTestId('flow-node-end')).toBeInTheDocument()
    expect(screen.getByTestId('edge-count')).toHaveTextContent('0')

    await user.click(screen.getByRole('button', { name: '保存草稿' }))

    const patchCall = fetchMock.mock.calls.find(([url, init]) => (
      url === `/api/workspaces/${workspace.id}/workflows/workflow-1` && init?.method === 'PATCH'
    ))
    const body = JSON.parse(patchCall?.[1]?.body as string)
    expect(body.nodes.map((node: { id: string }) => node.id)).toEqual(['start', 'end'])
    expect(body.edges).toEqual([])
  })

  it('undoes and redoes deleting a connected workflow node', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    const connectedWorkflow = {
      ...workflow,
      nodes: [
        {
          id: 'start',
          type: 'trigger',
          position: { x: 0, y: 0 },
          data: { label: '手动触发', subtitle: '启动工作流' },
        },
        {
          id: 'agent',
          type: 'agent',
          position: { x: 300, y: 0 },
          data: { label: '选择执行 Agent', subtitle: '尚未绑定发布版本' },
        },
        {
          id: 'end',
          type: 'end',
          position: { x: 600, y: 0 },
          data: { label: '流程完成', subtitle: '结束节点' },
        },
      ],
      edges: [
        { id: 'start-agent', source: 'start', target: 'agent' },
        { id: 'agent-end', source: 'agent', target: 'end' },
      ],
    }
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === `/api/workspaces/${workspace.id}/workflows`) {
        return Promise.resolve(new Response(JSON.stringify([connectedWorkflow]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/agents`) {
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

    await user.click(await screen.findByTestId('flow-node-agent'))
    await user.click(screen.getByRole('button', { name: '删除节点' }))
    await user.click(screen.getByRole('button', { name: '确认删除节点' }))

    expect(screen.queryByTestId('flow-node-agent')).not.toBeInTheDocument()
    expect(screen.getByTestId('edge-count')).toHaveTextContent('0')

    await user.click(screen.getByRole('button', { name: '撤销' }))

    expect(screen.getByTestId('flow-node-agent')).toHaveTextContent('选择执行 Agent')
    expect(screen.getByTestId('edge-count')).toHaveTextContent('2')
    expect(screen.getByTestId('flow-edge-start-agent')).toBeInTheDocument()
    expect(screen.getByTestId('flow-edge-agent-end')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '重做' }))

    expect(screen.queryByTestId('flow-node-agent')).not.toBeInTheDocument()
    expect(screen.getByTestId('edge-count')).toHaveTextContent('0')
  })

  it('selects and deletes a single edge without deleting nodes', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    const connectedWorkflow = {
      ...workflow,
      nodes: [
        {
          id: 'start',
          type: 'trigger',
          position: { x: 0, y: 0 },
          data: { label: '手动触发', subtitle: '启动工作流' },
        },
        {
          id: 'agent',
          type: 'agent',
          position: { x: 300, y: 0 },
          data: { label: '选择执行 Agent', subtitle: '尚未绑定发布版本' },
        },
        {
          id: 'end',
          type: 'end',
          position: { x: 600, y: 0 },
          data: { label: '流程完成', subtitle: '结束节点' },
        },
      ],
      edges: [
        { id: 'start-agent', source: 'start', target: 'agent' },
        { id: 'agent-end', source: 'agent', target: 'end' },
      ],
    }
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === `/api/workspaces/${workspace.id}/workflows` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([connectedWorkflow]), { status: 200 }))
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
        return Promise.resolve(new Response(JSON.stringify(connectedWorkflow), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWorkflows()

    await user.click(await screen.findByTestId('flow-edge-start-agent'))

    const edgeInspector = document.querySelector<HTMLElement>('.edge-inspector')
    expect(edgeInspector).not.toBeNull()
    expect(within(edgeInspector!).getByText('连线配置')).toBeInTheDocument()
    expect(within(edgeInspector!).getByText('上游节点')).toBeInTheDocument()
    expect(within(edgeInspector!).getByText('手动触发')).toBeInTheDocument()
    expect(within(edgeInspector!).getByText('下游节点')).toBeInTheDocument()
    expect(within(edgeInspector!).getByText('选择执行 Agent')).toBeInTheDocument()
    expect(within(edgeInspector!).getByText('start-agent')).toBeInTheDocument()
    expect(screen.queryByText('节点配置')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '删除连线' }))

    expect(screen.getByTestId('edge-count')).toHaveTextContent('1')
    expect(screen.getByTestId('flow-node-start')).toBeInTheDocument()
    expect(screen.getByTestId('flow-node-agent')).toBeInTheDocument()
    expect(screen.getByTestId('flow-node-end')).toBeInTheDocument()
    expect(screen.queryByTestId('flow-edge-start-agent')).not.toBeInTheDocument()
    expect(screen.getByTestId('flow-edge-agent-end')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '保存草稿' }))

    const patchCall = fetchMock.mock.calls.find(([url, init]) => (
      url === `/api/workspaces/${workspace.id}/workflows/workflow-1` && init?.method === 'PATCH'
    ))
    const body = JSON.parse(patchCall?.[1]?.body as string)
    expect(body.nodes.map((node: { id: string }) => node.id)).toEqual(['start', 'agent', 'end'])
    expect(body.edges).toEqual([
      expect.objectContaining({ id: 'agent-end', source: 'agent', target: 'end' }),
    ])
  })

  it('undoes and redoes deleting a workflow edge', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    const connectedWorkflow = {
      ...workflow,
      nodes: [
        {
          id: 'start',
          type: 'trigger',
          position: { x: 0, y: 0 },
          data: { label: '手动触发', subtitle: '启动工作流' },
        },
        {
          id: 'agent',
          type: 'agent',
          position: { x: 300, y: 0 },
          data: { label: '选择执行 Agent', subtitle: '尚未绑定发布版本' },
        },
        {
          id: 'end',
          type: 'end',
          position: { x: 600, y: 0 },
          data: { label: '流程完成', subtitle: '结束节点' },
        },
      ],
      edges: [
        { id: 'start-agent', source: 'start', target: 'agent' },
        { id: 'agent-end', source: 'agent', target: 'end' },
      ],
    }
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === `/api/workspaces/${workspace.id}/workflows`) {
        return Promise.resolve(new Response(JSON.stringify([connectedWorkflow]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/agents`) {
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

    await user.click(await screen.findByTestId('flow-edge-start-agent'))
    await user.click(screen.getByRole('button', { name: '删除连线' }))

    expect(screen.queryByTestId('flow-edge-start-agent')).not.toBeInTheDocument()
    expect(screen.getByTestId('edge-count')).toHaveTextContent('1')

    await user.click(screen.getByRole('button', { name: '撤销' }))

    expect(screen.getByTestId('flow-edge-start-agent')).toBeInTheDocument()
    expect(screen.getByTestId('flow-edge-agent-end')).toBeInTheDocument()
    expect(screen.getByTestId('edge-count')).toHaveTextContent('2')

    await user.click(screen.getByRole('button', { name: '重做' }))

    expect(screen.queryByTestId('flow-edge-start-agent')).not.toBeInTheDocument()
    expect(screen.getByTestId('flow-edge-agent-end')).toBeInTheDocument()
    expect(screen.getByTestId('edge-count')).toHaveTextContent('1')
  })

  it('warns about unsaved workflow changes before starting a new draft', async () => {
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
    expect(screen.queryByText('有未保存变更')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '添加手动触发节点' }))

    expect(screen.getByText('有未保存变更')).toBeInTheDocument()
    expect(screen.getByTestId('flow-node-human-1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '新建' }))

    expect(screen.getByText('放弃未保存变更？')).toBeInTheDocument()
    expect(screen.getByTestId('flow-node-human-1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '继续编辑' }))

    expect(screen.queryByText('放弃未保存变更？')).not.toBeInTheDocument()
    expect(screen.getByTestId('flow-node-human-1')).toBeInTheDocument()
    expect(screen.getByText('有未保存变更')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '新建' }))
    await user.click(screen.getByRole('button', { name: '放弃变更并继续' }))

    expect(screen.queryByTestId('flow-node-human-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('flow-node-start')).toBeInTheDocument()
    expect(screen.getByTestId('flow-node-agent')).toBeInTheDocument()
    expect(screen.getByTestId('flow-node-end')).toBeInTheDocument()
    expect(screen.queryByText('有未保存变更')).not.toBeInTheDocument()
  })

  it('undoes and redoes a newly added workflow node', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === `/api/workspaces/${workspace.id}/workflows`) {
        return Promise.resolve(new Response(JSON.stringify([workflow]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/agents`) {
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
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '重做' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '添加手动触发节点' }))

    const addedNode = await screen.findByTestId(/flow-node-trigger-/)
    expect(addedNode).toHaveTextContent('手动触发')
    expect(screen.getByRole('button', { name: '撤销' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '重做' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '撤销' }))

    expect(screen.queryByTestId(/flow-node-trigger-/)).not.toBeInTheDocument()
    expect(screen.getByTestId('flow-node-human-1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '重做' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: '重做' }))

    expect(await screen.findByTestId(/flow-node-trigger-/)).toHaveTextContent('手动触发')
    expect(screen.getByRole('button', { name: '撤销' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '重做' })).toBeDisabled()
  })

  it('uses keyboard shortcuts to undo and redo workflow canvas edits', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === `/api/workspaces/${workspace.id}/workflows`) {
        return Promise.resolve(new Response(JSON.stringify([workflow]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/agents`) {
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
    await user.click(screen.getByRole('button', { name: '添加手动触发节点' }))

    expect(await screen.findByTestId(/flow-node-trigger-/)).toHaveTextContent('手动触发')

    await user.keyboard('{Control>}z{/Control}')

    expect(screen.queryByTestId(/flow-node-trigger-/)).not.toBeInTheDocument()
    expect(screen.getByTestId('flow-node-human-1')).toBeInTheDocument()

    await user.keyboard('{Control>}y{/Control}')

    expect(await screen.findByTestId(/flow-node-trigger-/)).toHaveTextContent('手动触发')
  })

  it('keeps workflow keyboard shortcuts inactive while editing text fields', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === `/api/workspaces/${workspace.id}/workflows`) {
        return Promise.resolve(new Response(JSON.stringify([workflow]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/agents`) {
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
    await user.click(screen.getByRole('button', { name: '添加手动触发节点' }))
    expect(await screen.findByTestId(/flow-node-trigger-/)).toHaveTextContent('手动触发')

    await user.click(screen.getByLabelText('工作流名称'))
    await user.keyboard('{Control>}z{/Control}')

    expect(screen.getByTestId(/flow-node-trigger-/)).toBeInTheDocument()
  })

  it('deletes a selected workflow edge with the keyboard and keeps nodes', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    const connectedWorkflow = {
      ...workflow,
      nodes: [
        {
          id: 'start',
          type: 'trigger',
          position: { x: 0, y: 0 },
          data: { label: '手动触发', subtitle: '启动工作流' },
        },
        {
          id: 'agent',
          type: 'agent',
          position: { x: 300, y: 0 },
          data: { label: '选择执行 Agent', subtitle: '尚未绑定发布版本' },
        },
        {
          id: 'end',
          type: 'end',
          position: { x: 600, y: 0 },
          data: { label: '流程完成', subtitle: '结束节点' },
        },
      ],
      edges: [
        { id: 'start-agent', source: 'start', target: 'agent' },
        { id: 'agent-end', source: 'agent', target: 'end' },
      ],
    }
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === `/api/workspaces/${workspace.id}/workflows`) {
        return Promise.resolve(new Response(JSON.stringify([connectedWorkflow]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/agents`) {
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

    await user.click(await screen.findByTestId('flow-edge-start-agent'))
    await user.keyboard('{Delete}')

    expect(screen.queryByTestId('flow-edge-start-agent')).not.toBeInTheDocument()
    expect(screen.getByTestId('flow-edge-agent-end')).toBeInTheDocument()
    expect(screen.getByTestId('flow-node-start')).toBeInTheDocument()
    expect(screen.getByTestId('flow-node-agent')).toBeInTheDocument()
    expect(screen.getByTestId('flow-node-end')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '撤销' }))

    expect(screen.getByTestId('flow-edge-start-agent')).toBeInTheDocument()
    expect(screen.getByTestId('edge-count')).toHaveTextContent('2')
  })

  it('requires confirmation before deleting a selected workflow node with the keyboard', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    const connectedWorkflow = {
      ...workflow,
      nodes: [
        {
          id: 'start',
          type: 'trigger',
          position: { x: 0, y: 0 },
          data: { label: '手动触发', subtitle: '启动工作流' },
        },
        {
          id: 'agent',
          type: 'agent',
          position: { x: 300, y: 0 },
          data: { label: '选择执行 Agent', subtitle: '尚未绑定发布版本' },
        },
        {
          id: 'end',
          type: 'end',
          position: { x: 600, y: 0 },
          data: { label: '流程完成', subtitle: '结束节点' },
        },
      ],
      edges: [
        { id: 'start-agent', source: 'start', target: 'agent' },
        { id: 'agent-end', source: 'agent', target: 'end' },
      ],
    }
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === `/api/workspaces/${workspace.id}/workflows`) {
        return Promise.resolve(new Response(JSON.stringify([connectedWorkflow]), { status: 200 }))
      }
      if (url === `/api/workspaces/${workspace.id}/agents`) {
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

    await user.click(await screen.findByTestId('flow-node-agent'))
    await user.keyboard('{Delete}')

    expect(screen.getByRole('dialog', { name: '删除选中节点？' })).toBeInTheDocument()
    expect(screen.getByText('将同时移除 2 条关联连线。')).toBeInTheDocument()
    expect(screen.getByTestId('flow-node-agent')).toBeInTheDocument()
    expect(screen.getByTestId('edge-count')).toHaveTextContent('2')

    await user.click(screen.getByRole('button', { name: '取消删除' }))

    expect(screen.queryByRole('dialog', { name: '删除选中节点？' })).not.toBeInTheDocument()
    expect(screen.getByTestId('flow-node-agent')).toBeInTheDocument()

    await user.keyboard('{Delete}')
    await user.click(screen.getByRole('button', { name: '确认删除节点' }))

    expect(screen.queryByTestId('flow-node-agent')).not.toBeInTheDocument()
    expect(screen.getByTestId('edge-count')).toHaveTextContent('0')
  })

  it('clears the unsaved workflow warning after saving the draft', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    const savedWorkflow = {
      ...workflow,
      nodes: [
        ...workflow.nodes,
        {
          id: 'trigger-saved',
          type: 'trigger',
          position: { x: 160, y: 120 },
          data: { label: '手动触发', subtitle: '待配置' },
        },
      ],
    }
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
      if (url === `/api/workspaces/${workspace.id}/workflows/workflow-1` && init?.method === 'PATCH') {
        const body = JSON.parse(init.body as string)
        return Promise.resolve(new Response(JSON.stringify({
          ...savedWorkflow,
          nodes: body.nodes,
          edges: body.edges,
        }), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWorkflows()

    await screen.findByTestId('flow-node-human-1')
    await user.click(screen.getByRole('button', { name: '添加手动触发节点' }))

    expect(screen.getByText('有未保存变更')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '撤销' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: '保存草稿' }))

    expect(await screen.findByText('工作流草稿已保存')).toBeInTheDocument()
    expect(screen.queryByText('有未保存变更')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '重做' })).toBeDisabled()
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

  it('edits edge field mappings and saves them with the draft', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    const connectedWorkflow = {
      ...workflow,
      nodes: [
        {
          id: 'start',
          type: 'trigger',
          position: { x: 0, y: 0 },
          data: { label: '手动触发', subtitle: '启动工作流' },
        },
        {
          id: 'agent',
          type: 'agent',
          position: { x: 300, y: 0 },
          data: { label: '选择执行 Agent', subtitle: '尚未绑定发布版本' },
        },
      ],
      edges: [
        { id: 'start-agent', source: 'start', target: 'agent' },
      ],
    }
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === `/api/workspaces/${workspace.id}/workflows` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([connectedWorkflow]), { status: 200 }))
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
        const body = JSON.parse(init.body as string)
        return Promise.resolve(new Response(JSON.stringify({
          ...connectedWorkflow,
          edges: body.edges,
        }), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWorkflows()

    await user.click(await screen.findByTestId('flow-edge-start-agent'))
    await user.click(screen.getByRole('button', { name: '新增映射' }))
    await user.type(screen.getByLabelText('上游字段 1'), '$.asin')
    await user.type(screen.getByLabelText('下游字段 1'), '$.input.asin')
    await user.click(screen.getByRole('button', { name: '保存草稿' }))

    const patchCall = fetchMock.mock.calls.find(([url, init]) => (
      url === `/api/workspaces/${workspace.id}/workflows/workflow-1` && init?.method === 'PATCH'
    ))
    const body = JSON.parse(patchCall?.[1]?.body as string)
    expect(body.edges[0].data.mappings).toEqual([
      { sourcePath: '$.asin', targetPath: '$.input.asin' },
    ])
  })

  it('blocks saving edge mappings with blank paths', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    const connectedWorkflow = {
      ...workflow,
      nodes: [
        {
          id: 'start',
          type: 'trigger',
          position: { x: 0, y: 0 },
          data: { label: '手动触发', subtitle: '启动工作流' },
        },
        {
          id: 'agent',
          type: 'agent',
          position: { x: 300, y: 0 },
          data: { label: '选择执行 Agent', subtitle: '尚未绑定发布版本' },
        },
      ],
      edges: [
        { id: 'start-agent', source: 'start', target: 'agent' },
      ],
    }
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === `/api/workspaces/${workspace.id}/workflows` && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([connectedWorkflow]), { status: 200 }))
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
        return Promise.resolve(new Response(JSON.stringify(connectedWorkflow), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWorkflows()

    await user.click(await screen.findByTestId('flow-edge-start-agent'))
    await user.click(screen.getByRole('button', { name: '新增映射' }))
    await user.type(screen.getByLabelText('上游字段 1'), '$.asin')
    await user.click(screen.getByRole('button', { name: '保存草稿' }))

    expect(await screen.findByText('连线 start-agent 的第 1 条映射必须同时填写上游字段和下游字段')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url, init]) => (
      url === `/api/workspaces/${workspace.id}/workflows/workflow-1` && init?.method === 'PATCH'
    ))).toBe(false)
  })
})
