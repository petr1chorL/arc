import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Bot,
  Braces,
  Check,
  CircleCheck,
  Clock3,
  Copy,
  Database,
  FilePlus2,
  GitBranch,
  History,
  Plus,
  Play,
  Save,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Redo2,
  Undo2,
  UserCheck,
  Wrench,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useWorkspace } from '../auth/workspaceContextState'
import { listAgentVersions, listAgents } from '../api/agents'
import {
  createWorkflow,
  listWorkflowVersions,
  listWorkflows,
  publishWorkflow,
  updateWorkflow,
  validateWorkflow,
} from '../api/workflows'
import { runWorkflow } from '../api/execution'
import { listReviewers, listReviewGroups } from '../api/humanTasks'
import { WorkflowNode, type WorkflowNodeData } from '../components/WorkflowNode'
import { fromContractGraph, toContractGraph } from '../domain/workflows'
import { displayStatus, isWaitingForHumanReview } from '../domain/statusText'
import type {
  AgentVersion,
  ExecutionRun,
  Reviewer,
  ReviewGroup,
  WorkflowDraft,
  WorkflowVersion,
} from '../types'

const nodeTypes = { workflow: WorkflowNode }
const nodeDragDataType = 'application/arc-one-node'

function createDefaultNodes(): Node[] {
  return [
    {
      id: 'start',
      type: 'workflow',
      position: { x: 80, y: 220 },
      data: { label: '手动触发', subtitle: '启动工作流', kind: 'trigger', status: 'idle' } satisfies WorkflowNodeData,
    },
    {
      id: 'agent',
      type: 'workflow',
      position: { x: 390, y: 220 },
      data: { label: '选择执行 Agent', subtitle: '尚未绑定发布版本', kind: 'agent', status: 'warning' } satisfies WorkflowNodeData,
    },
    {
      id: 'end',
      type: 'workflow',
      position: { x: 720, y: 220 },
      data: { label: '流程完成', subtitle: '结束节点', kind: 'end', status: 'idle' } satisfies WorkflowNodeData,
    },
  ]
}

function createDefaultEdges(): Edge[] {
  return [
    { id: 'start-agent', source: 'start', target: 'agent' },
    { id: 'agent-end', source: 'agent', target: 'end' },
  ]
}

function fallbackNodePosition(index: number) {
  return { x: 300 + (index % 3) * 260, y: 100 + Math.floor(index / 3) * 180 }
}

function hasValidPosition(node: Node) {
  return Number.isFinite(node.position?.x) && Number.isFinite(node.position?.y)
}

function sanitizeWorkflowNodes(items: Node[]) {
  return items.map((node, index) => (
    hasValidPosition(node) ? node : { ...node, position: fallbackNodePosition(index) }
  ))
}

function cloneNodeData(data: Node['data']) {
  return JSON.parse(JSON.stringify(data)) as Record<string, unknown>
}

const palette: Array<{ label: string; icon: typeof Bot; kind: WorkflowNodeData['kind'] }> = [
  { label: '手动触发', icon: Play, kind: 'trigger' },
  { label: 'Agent', icon: Bot, kind: 'agent' },
  { label: '工具调用', icon: Wrench, kind: 'tool' },
  { label: '数据查询', icon: Database, kind: 'data' },
  { label: '条件分支', icon: GitBranch, kind: 'branch' },
  { label: '质量门禁', icon: ShieldCheck, kind: 'gate' },
  { label: '人工审核', icon: UserCheck, kind: 'human' },
  { label: '代码执行', icon: Braces, kind: 'code' },
  { label: '等待节点', icon: Clock3, kind: 'wait' },
  { label: '流程完成', icon: CircleCheck, kind: 'end' },
]

interface PublishedAgentOption {
  agentId: string
  agentName: string
  version: AgentVersion
}

interface NodeEdgeImpact {
  incoming: number
  outgoing: number
  total: number
}

interface CanvasSnapshot {
  nodes: Node[]
  edges: Edge[]
}

type PendingWorkflowNavigation =
  | { kind: 'new' }
  | { kind: 'activate'; workflowId: string }

function cloneCanvasSnapshot(nodes: Node[], edges: Edge[]): CanvasSnapshot {
  return {
    nodes: sanitizeWorkflowNodes(nodes).map((node) => ({
      ...node,
      position: { ...node.position },
      data: cloneNodeData(node.data),
    })),
    edges: edges.map((edge) => ({ ...edge })),
  }
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  return target.isContentEditable || ['input', 'textarea', 'select'].includes(tagName)
}

function getNodeEdgeImpact(nodeId: string, edges: Edge[]): NodeEdgeImpact {
  const incoming = edges.filter((edge) => edge.target === nodeId).length
  const outgoing = edges.filter((edge) => edge.source === nodeId).length
  return {
    incoming,
    outgoing,
    total: incoming + outgoing,
  }
}

function createDraftSignature(name: string, nodes: Node[], edges: Edge[]) {
  return JSON.stringify({
    name: name.trim() || '未命名工作流',
    ...toContractGraph(sanitizeWorkflowNodes(nodes), edges),
  })
}

export function Workflows() {
  const { workspace, workspacePath } = useWorkspace()
  const reactFlowRef = useRef<ReactFlowInstance | null>(null)
  const [nodes, setNodes, onNodesChange] = useNodesState(createDefaultNodes())
  const [edges, setEdges, onEdgesChange] = useEdgesState(createDefaultEdges())
  const [workflows, setWorkflows] = useState<WorkflowDraft[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [name, setName] = useState('未命名工作流')
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null)
  const [agentOptions, setAgentOptions] = useState<PublishedAgentOption[]>([])
  const [reviewers, setReviewers] = useState<Reviewer[]>([])
  const [reviewGroups, setReviewGroups] = useState<ReviewGroup[]>([])
  const [versions, setVersions] = useState<WorkflowVersion[]>([])
  const [showVersions, setShowVersions] = useState(false)
  const [showRun, setShowRun] = useState(false)
  const [runInput, setRunInput] = useState('')
  const [runResult, setRunResult] = useState<ExecutionRun | null>(null)
  const [feedback, setFeedback] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [isBusy, setIsBusy] = useState(false)
  const [savedDraftSignature, setSavedDraftSignature] = useState('')
  const [pendingNavigation, setPendingNavigation] = useState<PendingWorkflowNavigation | null>(null)
  const [keyboardDeleteNode, setKeyboardDeleteNode] = useState<Node | null>(null)
  const [undoStack, setUndoStack] = useState<CanvasSnapshot[]>([])
  const [redoStack, setRedoStack] = useState<CanvasSnapshot[]>([])
  const renderedNodes = useMemo(() => sanitizeWorkflowNodes(nodes), [nodes])
  const draftSignature = useMemo(
    () => createDraftSignature(name, renderedNodes, edges),
    [edges, name, renderedNodes],
  )
  const hasUnsavedChanges = savedDraftSignature !== '' && draftSignature !== savedDraftSignature

  const resetCanvasHistory = useCallback(() => {
    setUndoStack([])
    setRedoStack([])
  }, [])

  const commitCanvasChange = useCallback((nextNodes: Node[], nextEdges: Edge[], nextFeedback?: string) => {
    setUndoStack((current) => [...current, cloneCanvasSnapshot(nodes, edges)].slice(-50))
    setRedoStack([])
    setNodes(nextNodes)
    setEdges(nextEdges)
    setSelectedNode(null)
    setSelectedEdge(null)
    setKeyboardDeleteNode(null)
    if (nextFeedback) setFeedback(nextFeedback)
  }, [edges, nodes, setEdges, setNodes])

  const undoCanvasChange = useCallback(() => {
    const previous = undoStack.at(-1)
    if (!previous) return
    setUndoStack((current) => current.slice(0, -1))
    setRedoStack((current) => [...current, cloneCanvasSnapshot(nodes, edges)].slice(-50))
    setNodes(previous.nodes)
    setEdges(previous.edges)
    setSelectedNode(null)
    setSelectedEdge(null)
    setKeyboardDeleteNode(null)
    setFeedback('已撤销上一步画布编辑')
  }, [edges, nodes, setEdges, setNodes, undoStack])

  const redoCanvasChange = useCallback(() => {
    const next = redoStack.at(-1)
    if (!next) return
    setRedoStack((current) => current.slice(0, -1))
    setUndoStack((current) => [...current, cloneCanvasSnapshot(nodes, edges)].slice(-50))
    setNodes(next.nodes)
    setEdges(next.edges)
    setSelectedNode(null)
    setSelectedEdge(null)
    setKeyboardDeleteNode(null)
    setFeedback('已重做画布编辑')
  }, [edges, nodes, redoStack, setEdges, setNodes])

  useEffect(() => {
    function handleKeyboardShortcut(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return
      const key = event.key.toLowerCase()
      const isUndo = (event.ctrlKey || event.metaKey) && !event.shiftKey && key === 'z'
      const isRedo = (event.ctrlKey || event.metaKey) && (key === 'y' || (event.shiftKey && key === 'z'))
      if (isUndo) {
        event.preventDefault()
        undoCanvasChange()
        return
      }
      if (isRedo) {
        event.preventDefault()
        redoCanvasChange()
        return
      }
      const isDelete = event.key === 'Delete' || event.key === 'Backspace'
      if (!isDelete || event.ctrlKey || event.metaKey || event.altKey) return
      if (selectedEdge) {
        event.preventDefault()
        commitCanvasChange(
          nodes,
          edges.filter((edge) => edge.id !== selectedEdge.id),
          '连线已删除，保存草稿后持久化',
        )
        return
      }
      if (selectedNode) {
        event.preventDefault()
        setKeyboardDeleteNode(selectedNode)
      }
    }
    window.addEventListener('keydown', handleKeyboardShortcut)
    return () => window.removeEventListener('keydown', handleKeyboardShortcut)
  }, [commitCanvasChange, edges, nodes, redoCanvasChange, selectedEdge, selectedNode, undoCanvasChange])

  const onConnect = useCallback(
    (connection: Connection) => commitCanvasChange(nodes, addEdge(connection, edges), '连线已添加，保存草稿后持久化'),
    [commitCanvasChange, edges, nodes],
  )

  const activateWorkflow = useCallback((workflow: WorkflowDraft) => {
    const graph = fromContractGraph(workflow.nodes, workflow.edges)
    setCurrentId(workflow.id)
    setName(workflow.name)
    setNodes(graph.nodes)
    setEdges(graph.edges)
    setSavedDraftSignature(createDraftSignature(workflow.name, graph.nodes, graph.edges))
    setSelectedNode(null)
    setSelectedEdge(null)
    setPendingNavigation(null)
    setKeyboardDeleteNode(null)
    resetCanvasHistory()
    setFeedback('')
    setErrors([])
    void listWorkflowVersions(workspace.id, workflow.id).then(setVersions)
  }, [resetCanvasHistory, setEdges, setNodes, workspace.id])

  useEffect(() => {
    async function load() {
      const [savedWorkflows, agents, directoryReviewers, directoryGroups] = await Promise.all([
        listWorkflows(workspace.id),
        listAgents(workspace.id),
        listReviewers(workspace.id).catch(() => []),
        listReviewGroups(workspace.id).catch(() => []),
      ])
      setReviewers(directoryReviewers)
      setReviewGroups(directoryGroups)
      setWorkflows(savedWorkflows)
      if (savedWorkflows[0]) {
        activateWorkflow(savedWorkflows[0])
      }
      const versionGroups = await Promise.all(
        agents
          .filter((agent) => agent.status !== '已停用')
          .map(async (agent) => ({
            agent,
            versions: await listAgentVersions(workspace.id, agent.id),
          })),
      )
      setAgentOptions(versionGroups.flatMap(({ agent, versions: published }) => (
        published.map((version) => ({
          agentId: agent.id,
          agentName: agent.name,
          version,
        }))
      )))
    }
    void load()
  }, [activateWorkflow, workspace.id])

  const currentWorkflow = workflows.find((workflow) => workflow.id === currentId)
  const statusText = currentWorkflow
    ? `${currentWorkflow.status} · ${currentWorkflow.version}`
    : '新草稿 · 未保存'
  const selectedNodeEdgeImpact = useMemo<NodeEdgeImpact>(
    () => selectedNode ? getNodeEdgeImpact(selectedNode.id, edges) : { incoming: 0, outgoing: 0, total: 0 },
    [edges, selectedNode],
  )
  const keyboardDeleteNodeImpact = useMemo<NodeEdgeImpact>(
    () => keyboardDeleteNode ? getNodeEdgeImpact(keyboardDeleteNode.id, edges) : { incoming: 0, outgoing: 0, total: 0 },
    [edges, keyboardDeleteNode],
  )

  const saveDraft = useCallback(async () => {
    setIsBusy(true)
    setErrors([])
    try {
      const graph = toContractGraph(renderedNodes, edges)
      const input = { name: name.trim() || '未命名工作流', ...graph }
      const saved = currentId
        ? await updateWorkflow(workspace.id, currentId, input)
        : await createWorkflow(workspace.id, input)
      setCurrentId(saved.id)
      setWorkflows((current) => {
        const exists = current.some((workflow) => workflow.id === saved.id)
        return exists
          ? current.map((workflow) => workflow.id === saved.id ? saved : workflow)
          : [saved, ...current]
      })
      const savedGraph = fromContractGraph(saved.nodes, saved.edges)
      setSavedDraftSignature(createDraftSignature(saved.name, savedGraph.nodes, savedGraph.edges))
      resetCanvasHistory()
      setFeedback('工作流草稿已保存')
      return saved
    } catch (saveError) {
      setErrors([saveError instanceof Error ? saveError.message : '工作流保存失败'])
      return null
    } finally {
      setIsBusy(false)
    }
  }, [currentId, edges, name, renderedNodes, resetCanvasHistory, workspace.id])

  async function publish() {
    const saved = await saveDraft()
    if (!saved) return
    setIsBusy(true)
    try {
      const validation = await validateWorkflow(workspace.id, saved.id)
      if (!validation.valid) {
        setErrors(validation.errors)
        return
      }
      const version = await publishWorkflow(workspace.id, saved.id)
      setVersions((current) => [version, ...current])
      setWorkflows((current) => current.map((workflow) => (
        workflow.id === saved.id
          ? { ...workflow, status: '已发布', version: version.version }
          : workflow
      )))
      setFeedback(`${version.version} 已发布`)
      setErrors([])
    } catch (publishError) {
      setErrors([publishError instanceof Error ? publishError.message : '工作流发布失败'])
    } finally {
      setIsBusy(false)
    }
  }

  async function executeWorkflow() {
    if (!currentId || !runInput.trim()) {
      setErrors(['请输入运行任务'])
      return
    }
    setIsBusy(true)
    setErrors([])
    setRunResult(null)
    try {
      const result = await runWorkflow(workspace.id, currentId, {
        input: runInput.trim(),
        version: currentWorkflow?.version,
      })
      setRunResult(result)
      setFeedback(isWaitingForHumanReview(result.status) ? '等待人工审核处理' : '工作流运行已完成')
    } catch (runError) {
      setErrors([runError instanceof Error ? runError.message : '工作流运行失败'])
    } finally {
      setIsBusy(false)
    }
  }

  function resetToNewWorkflow() {
    const defaultNodes = createDefaultNodes()
    const defaultEdges = createDefaultEdges()
    setCurrentId(null)
    setName('未命名工作流')
    setNodes(defaultNodes)
    setEdges(defaultEdges)
    setSavedDraftSignature(createDraftSignature('未命名工作流', defaultNodes, defaultEdges))
    resetCanvasHistory()
    setSelectedNode(null)
    setSelectedEdge(null)
    setPendingNavigation(null)
    setKeyboardDeleteNode(null)
    setVersions([])
    setErrors([])
    setFeedback('')
  }

  function startNewWorkflow() {
    if (hasUnsavedChanges) {
      setPendingNavigation({ kind: 'new' })
      return
    }
    resetToNewWorkflow()
  }

  function requestWorkflowActivation(workflowId: string) {
    if (workflowId === currentId) return
    if (hasUnsavedChanges) {
      setPendingNavigation({ kind: 'activate', workflowId })
      return
    }
    const workflow = workflows.find((item) => item.id === workflowId)
    if (workflow) activateWorkflow(workflow)
  }

  function continueAfterDiscardingChanges() {
    if (!pendingNavigation) return
    if (pendingNavigation.kind === 'new') {
      resetToNewWorkflow()
      return
    }
    const workflow = workflows.find((item) => item.id === pendingNavigation.workflowId)
    if (workflow) activateWorkflow(workflow)
  }

  function addNode(kind: WorkflowNodeData['kind'], label: string, position?: { x: number; y: number }) {
    const id = `${kind}-${Date.now()}`
    const fallbackPosition = fallbackNodePosition(nodes.length)
    const nextPosition = position
      && Number.isFinite(position.x)
      && Number.isFinite(position.y)
      ? position
      : fallbackPosition
    const nextNodes = [
      ...nodes,
      {
        id,
        type: 'workflow',
        position: nextPosition,
        data: {
          label,
          subtitle: kind === 'agent' ? '尚未绑定发布版本' : '待配置',
          kind,
          status: kind === 'agent' ? 'warning' : 'idle',
        } satisfies WorkflowNodeData,
      },
    ]
    commitCanvasChange(nextNodes, edges, '节点已添加，保存草稿后持久化')
  }

  function startPaletteDrag(event: DragEvent<HTMLButtonElement>, kind: WorkflowNodeData['kind'], label: string) {
    event.dataTransfer.setData(nodeDragDataType, JSON.stringify({ kind, label }))
    event.dataTransfer.effectAllowed = 'copy'
  }

  function allowPaletteDrop(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes(nodeDragDataType)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  function resolveDropPosition(event: DragEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const screenPosition = {
      x: Number.isFinite(event.clientX) ? event.clientX : bounds.left,
      y: Number.isFinite(event.clientY) ? event.clientY : bounds.top,
    }
    if (reactFlowRef.current) {
      try {
        const flowPosition = reactFlowRef.current.screenToFlowPosition(screenPosition)
        if (Number.isFinite(flowPosition.x) && Number.isFinite(flowPosition.y)) {
          return flowPosition
        }
      } catch {
        // React Flow can reject synthetic or interrupted drag events; fall back to the canvas box.
      }
    }
    return {
      x: screenPosition.x - bounds.left,
      y: screenPosition.y - bounds.top,
    }
  }

  function dropPaletteNode(event: DragEvent<HTMLDivElement>) {
    const raw = event.dataTransfer.getData(nodeDragDataType)
    if (!raw) return
    event.preventDefault()
    try {
      const parsed = JSON.parse(raw) as { kind?: WorkflowNodeData['kind']; label?: string }
      const paletteItem = palette.find((item) => item.kind === parsed.kind && item.label === parsed.label)
      if (!paletteItem) return
      const position = resolveDropPosition(event)
      addNode(paletteItem.kind, paletteItem.label, position)
    } catch {
      // Ignore malformed drag payloads from outside the node palette.
    }
  }

  function updateSelectedNode(nextData: Record<string, unknown>) {
    if (!selectedNode) return
    setNodes((current) => current.map((node) => (
      node.id === selectedNode.id
        ? { ...node, data: { ...node.data, ...nextData } }
        : node
    )))
    setSelectedNode((current) => current ? { ...current, data: { ...current.data, ...nextData } } : current)
  }

  function removeSelectedNode() {
    if (!selectedNode) return
    commitCanvasChange(
      nodes.filter((node) => node.id !== selectedNode.id),
      edges.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id),
    )
  }

  function removeSelectedEdge() {
    if (!selectedEdge) return
    commitCanvasChange(
      nodes,
      edges.filter((edge) => edge.id !== selectedEdge.id),
      '连线已删除，保存草稿后持久化',
    )
  }

  function confirmKeyboardNodeDelete() {
    if (!keyboardDeleteNode) return
    const nodeId = keyboardDeleteNode.id
    commitCanvasChange(
      nodes.filter((node) => node.id !== nodeId),
      edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
    )
  }

  function duplicateSelectedNode() {
    if (!selectedNode) return
    const data = selectedNode.data as WorkflowNodeData
    const basePosition = hasValidPosition(selectedNode)
      ? selectedNode.position
      : fallbackNodePosition(nodes.length)
    const duplicate: Node = {
      id: `${data.kind ?? 'node'}-copy-${Date.now()}`,
      type: selectedNode.type ?? 'workflow',
      position: {
        x: basePosition.x + 40,
        y: basePosition.y + 40,
      },
      data: cloneNodeData(selectedNode.data),
    }
    commitCanvasChange([...nodes, duplicate], edges, '节点已复制，保存草稿后持久化')
    setSelectedNode(duplicate)
  }

  return (
    <div className="workflow-studio">
      {feedback && <div className="toast"><Check size={16} />{feedback}</div>}
      <div className="studio-toolbar">
        <div className="workflow-title">
          <button className="workflow-icon"><GitBranch size={18} /></button>
          <div>
            <input aria-label="工作流名称" value={name} onChange={(event) => setName(event.target.value)} />
            <span>{statusText}</span>
          </div>
          {workflows.length > 0 && (
            <select
              aria-label="切换工作流"
              value={currentId ?? ''}
              onChange={(event) => requestWorkflowActivation(event.target.value)}
            >
              {currentId === null && <option value="">新草稿</option>}
              {workflows.map((workflow) => <option value={workflow.id} key={workflow.id}>{workflow.name}</option>)}
            </select>
          )}
        </div>
        <div className="studio-actions">
          <button className="button ghost" title="撤销上一步画布编辑" disabled={undoStack.length === 0} onClick={undoCanvasChange}><Undo2 size={15} />撤销</button>
          <button className="button ghost" title="重做刚撤销的画布编辑" disabled={redoStack.length === 0} onClick={redoCanvasChange}><Redo2 size={15} />重做</button>
          <button className="button ghost" title="新建工作流" onClick={startNewWorkflow}><FilePlus2 size={15} />新建</button>
          <button className="button ghost" title="查看版本记录" disabled={!currentId} onClick={() => setShowVersions(true)}><History size={15} />版本记录</button>
          <button
            className="button ghost"
            title="运行已发布工作流"
            disabled={!currentWorkflow || currentWorkflow.version === '未发布' || isBusy}
            onClick={() => {
              setRunResult(null)
              setShowRun(true)
            }}
          >
            <Play size={15} />运行工作流
          </button>
          <button className="button secondary" title="保存工作流草稿" disabled={isBusy} onClick={() => void saveDraft()}><Save size={15} />保存草稿</button>
          <button className="button primary" title="发布工作流版本" disabled={isBusy} onClick={() => void publish()}><Send size={15} />发布版本</button>
        </div>
      </div>

      {hasUnsavedChanges && (
        <div className="workflow-unsaved" role="status">
          <strong>有未保存变更</strong>
          <span>保存草稿后再离开，或在确认提示中放弃本次修改。</span>
        </div>
      )}

      {errors.length > 0 && (
        <div className="workflow-errors" role="alert">
          <ShieldAlert size={17} />
          <div><strong>发布前需要处理</strong>{errors.map((error) => <span key={error}>{error}</span>)}</div>
          <button className="icon-button quiet" title="关闭错误提示" onClick={() => setErrors([])}><X size={16} /></button>
        </div>
      )}

      <div className="studio-body">
        <aside className="node-palette">
          <label className="palette-search"><Search size={15} /><input placeholder="搜索节点" /></label>
          <span className="nav-section-label">基础节点</span>
          {palette.map(({ label, icon: Icon, kind }) => (
            <button
              aria-label={`添加${label}节点`}
              key={label}
              className="palette-item"
              title={`添加${label}节点`}
              draggable
              onDragStart={(event) => startPaletteDrag(event, kind, label)}
              onClick={() => addNode(kind, label)}
            >
              <span className={`palette-icon ${kind}`}><Icon size={16} /></span>{label}<Plus size={14} />
            </button>
          ))}
        </aside>

        <div className="flow-canvas">
          <ReactFlow
            nodes={renderedNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => {
              setSelectedEdge(null)
              setSelectedNode(node)
            }}
            onEdgeClick={(_, edge) => {
              setSelectedNode(null)
              setSelectedEdge(edge)
            }}
            onInit={(instance) => {
              reactFlowRef.current = instance
            }}
            onDragOver={allowPaletteDrop}
            onDrop={dropPaletteNode}
            nodeTypes={nodeTypes}
            connectionLineStyle={{ stroke: '#6579a8', strokeWidth: 2 }}
            connectionRadius={24}
            defaultEdgeOptions={{
              type: 'smoothstep',
              markerEnd: {
                type: MarkerType.ArrowClosed,
                color: '#8795b5',
              },
            }}
            fitView
            minZoom={0.35}
            maxZoom={1.5}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.3} color="#c7ccc9" />
            <Controls position="bottom-left" />
            <MiniMap position="bottom-right" pannable zoomable nodeColor={(node) => {
              const data = node.data as WorkflowNodeData
              return data.kind === 'human' ? '#ef9f50' : data.kind === 'gate' ? '#2e7d6c' : '#707975'
            }} />
          </ReactFlow>
          <div className="canvas-status"><span className="live-dot" />{currentId ? '草稿已连接数据库' : '新草稿尚未保存'} · {nodes.length} 个节点</div>
        </div>

        {selectedNode && (
          <NodeInspector
            node={selectedNode}
            agentOptions={agentOptions}
            reviewers={reviewers}
            reviewGroups={reviewGroups}
            edgeImpact={selectedNodeEdgeImpact}
            onClose={() => setSelectedNode(null)}
            onUpdate={updateSelectedNode}
            onDuplicate={duplicateSelectedNode}
            onDelete={removeSelectedNode}
          />
        )}
        {selectedEdge && (
          <EdgeInspector
            edge={selectedEdge}
            nodes={renderedNodes}
            onClose={() => setSelectedEdge(null)}
            onDelete={removeSelectedEdge}
          />
        )}
      </div>

      {keyboardDeleteNode && (
        <div className="dialog-backdrop">
          <section className="agent-dialog" role="dialog" aria-modal="true" aria-labelledby="keyboard-delete-node-title">
            <header>
              <div>
                <p className="eyebrow">KEYBOARD ACTION</p>
                <h2 id="keyboard-delete-node-title">删除选中节点？</h2>
              </div>
              <button className="icon-button quiet" title="关闭" onClick={() => setKeyboardDeleteNode(null)}><X size={18} /></button>
            </header>
            <p className="dialog-copy">
              {keyboardDeleteNodeImpact.total > 0
                ? `将同时移除 ${keyboardDeleteNodeImpact.total} 条关联连线。`
                : '该节点没有关联连线。'}
            </p>
            <div className="dialog-actions">
              <button className="button secondary" onClick={() => setKeyboardDeleteNode(null)}>取消删除</button>
              <button className="button danger" onClick={confirmKeyboardNodeDelete}><Trash2 size={14} />确认删除节点</button>
            </div>
          </section>
        </div>
      )}

      {pendingNavigation && (
        <div className="dialog-backdrop">
          <section className="agent-dialog" role="dialog" aria-modal="true" aria-labelledby="discard-workflow-title">
            <header>
              <div>
                <p className="eyebrow">UNSAVED CHANGES</p>
                <h2 id="discard-workflow-title">放弃未保存变更？</h2>
              </div>
              <button className="icon-button quiet" title="关闭" onClick={() => setPendingNavigation(null)}><X size={18} /></button>
            </header>
            <p className="dialog-copy">当前工作流草稿还没有保存。继续操作会丢弃本次画布修改。</p>
            <div className="dialog-actions">
              <button className="button secondary" onClick={() => setPendingNavigation(null)}>继续编辑</button>
              <button className="button danger" onClick={continueAfterDiscardingChanges}>放弃变更并继续</button>
            </div>
          </section>
        </div>
      )}

      {showVersions && (
        <div className="dialog-backdrop">
          <section className="agent-dialog workflow-version-dialog" role="dialog" aria-modal="true" aria-labelledby="workflow-version-title">
            <header>
              <div><p className="eyebrow">IMMUTABLE SNAPSHOTS</p><h2 id="workflow-version-title">工作流版本记录</h2></div>
              <button className="icon-button quiet" title="关闭" onClick={() => setShowVersions(false)}><X size={18} /></button>
            </header>
            <div className="version-list">
              {versions.length === 0 && <div className="version-empty">尚未发布版本</div>}
              {versions.map((version) => (
                <article className="version-item" key={version.id}>
                  <div><strong>{version.version}</strong><span>{version.snapshot.nodes.length} 个节点</span></div>
                  <p>{version.snapshot.name}</p>
                  <small>{new Date(version.createdAt).toLocaleString('zh-CN')}</small>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}

      {showRun && (
        <div className="dialog-backdrop">
          <section className="agent-dialog workflow-run-dialog" role="dialog" aria-modal="true" aria-labelledby="workflow-run-title">
            <header>
              <div><p className="eyebrow">PUBLISHED WORKFLOW</p><h2 id="workflow-run-title">运行工作流</h2></div>
              <button className="icon-button quiet" title="关闭" onClick={() => setShowRun(false)}><X size={18} /></button>
            </header>
            <label className="form-field">
              <span>运行输入</span>
              <textarea
                rows={5}
                value={runInput}
                onChange={(event) => setRunInput(event.target.value)}
                placeholder="输入本次工作流需要处理的任务"
              />
            </label>
            <div className="dialog-actions">
              <button className="button secondary" onClick={() => setShowRun(false)}>取消</button>
              <button className="button primary" disabled={isBusy} onClick={() => void executeWorkflow()}>
                <Play size={15} />开始运行
              </button>
            </div>
            {runResult && (
              <div className="agent-test-result">
                {isWaitingForHumanReview(runResult.status) && (
                  <div className="review-handoff-notice">
                    <div>
                      <strong>工作流已暂停在人工审核节点</strong>
                      <span>系统已经创建 Human Task。下一步到人工审核页认领并提交决定，运行中心会记录暂停与恢复状态。</span>
                    </div>
                    <a className="button primary" href={workspacePath('reviews')}>去人工审核处理</a>
                    <a className="button secondary" href={workspacePath('runs')}>查看运行记录</a>
                  </div>
                )}
                <div className="run-kpis">
                  <div><span>状态</span><strong>{displayStatus(runResult.status)}</strong></div>
                  <div><span>Token</span><strong>{runResult.totalTokens}</strong></div>
                  <div><span>质量得分</span><strong>{runResult.score ?? '待评估'}</strong></div>
                  <div><span>耗时</span><strong>{runResult.durationMs} ms</strong></div>
                </div>
                <div className="artifact-preview"><p>{runResult.output || runResult.error}</p></div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function NodeInspector({
  node,
  agentOptions,
  reviewers,
  reviewGroups,
  edgeImpact,
  onClose,
  onUpdate,
  onDuplicate,
  onDelete,
}: {
  node: Node
  agentOptions: PublishedAgentOption[]
  reviewers: Reviewer[]
  reviewGroups: ReviewGroup[]
  edgeImpact: NodeEdgeImpact
  onClose: () => void
  onUpdate: (data: Record<string, unknown>) => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const data = node.data as WorkflowNodeData & {
    agentId?: string
    agentVersion?: string
    assignmentType?: 'direct_reviewer' | 'group_claim' | 'round_robin'
    reviewerIds?: string[]
    groupId?: string
    reviewPolicy?: 'any_one' | 'all' | 'threshold'
    requiredApprovals?: number
    dueMinutes?: number
    escalationMinutes?: number
    escalationGroupId?: string
  }
  const selectedAgent = data.agentId && data.agentVersion ? `${data.agentId}|${data.agentVersion}` : ''
  const isAgent = data.kind === 'agent'
  const isHuman = data.kind === 'human'
  const optionsByAgent = useMemo(() => agentOptions, [agentOptions])

  useEffect(() => {
    setIsConfirmingDelete(false)
  }, [node.id])

  return (
    <aside className="node-inspector">
      <header><div><span className="section-kicker">节点配置</span><h3>{data.label}</h3></div><button onClick={onClose}>×</button></header>
      <label className="form-field"><span>节点名称</span><input value={data.label} onChange={(event) => onUpdate({ label: event.target.value })} /></label>
      {isAgent && (
        <label className="form-field">
          <span>已发布 Agent 版本</span>
          <select
            value={selectedAgent}
            onChange={(event) => {
              const option = optionsByAgent.find((item) => `${item.agentId}|${item.version.version}` === event.target.value)
              onUpdate(option ? {
                agentId: option.agentId,
                agentVersion: option.version.version,
                subtitle: `${option.agentName} · ${option.version.version}`,
                status: 'idle',
              } : {
                agentId: undefined,
                agentVersion: undefined,
                subtitle: '尚未绑定发布版本',
                status: 'warning',
              })
            }}
          >
            <option value="">请选择已发布版本</option>
            {optionsByAgent.map((option) => (
              <option value={`${option.agentId}|${option.version.version}`} key={`${option.agentId}-${option.version.id}`}>
                {option.agentName} · {option.version.version}
              </option>
            ))}
          </select>
          {optionsByAgent.length === 0 && <small>请先在 Agent 详情页发布至少一个版本。</small>}
        </label>
      )}
      {isHuman && (
        <>
          <div className="inspector-group">
            <span className="inspector-group-title">分配规则</span>
            <label className="form-field">
              <span>分配方式</span>
              <select
                aria-label="分配方式"
                value={data.assignmentType ?? 'group_claim'}
                onChange={(event) => onUpdate({
                  assignmentType: event.target.value,
                  subtitle: event.target.value === 'round_robin' ? '审核组轮询分配' : '等待人工认领',
                })}
              >
                <option value="direct_reviewer">指定审核人</option>
                <option value="group_claim">审核组认领</option>
                <option value="round_robin">审核组轮询</option>
              </select>
            </label>
            {data.assignmentType === 'direct_reviewer' ? (
              <label className="form-field">
                <span>指定审核人</span>
                <select
                  aria-label="指定审核人"
                  value={data.reviewerIds?.[0] ?? ''}
                  onChange={(event) => onUpdate({
                    reviewerIds: event.target.value ? [event.target.value] : [],
                    groupId: undefined,
                  })}
                >
                  <option value="">请选择审核人</option>
                  {reviewers.filter((reviewer) => reviewer.isActive).map((reviewer) => (
                    <option value={reviewer.id} key={reviewer.id}>
                      {reviewer.name} · {reviewer.role}
                    </option>
                  ))}
                </select>
                <small>这里只显示已授予 Reviewer 资格且仍启用的成员。没看到的人，请先到成员与权限绑定 Reviewer 资格。</small>
              </label>
            ) : (
              <label className="form-field">
                <span>审核组</span>
                <select
                  aria-label="审核组"
                  value={data.groupId ?? ''}
                  onChange={(event) => {
                    const group = reviewGroups.find((item) => item.id === event.target.value)
                    onUpdate({
                      groupId: group?.id,
                      reviewerIds: group?.members.map((member) => member.id) ?? [],
                    })
                  }}
                >
                  <option value="">请选择审核组</option>
                  {reviewGroups.filter((group) => !group.isEscalationGroup).map((group) => (
                    <option value={group.id} key={group.id}>{group.name}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="inspector-group">
            <span className="inspector-group-title">会签策略</span>
            <label className="form-field">
              <span>会签策略</span>
              <select
                aria-label="会签策略"
                value={data.reviewPolicy ?? 'any_one'}
                onChange={(event) => onUpdate({
                  reviewPolicy: event.target.value,
                  requiredApprovals: event.target.value === 'any_one'
                    ? 1
                    : data.requiredApprovals ?? 2,
                })}
              >
                <option value="any_one">任一人通过</option>
                <option value="all">全员通过</option>
                <option value="threshold">达到指定人数</option>
              </select>
            </label>
            {data.reviewPolicy === 'threshold' && (
              <label className="form-field">
                <span>通过人数</span>
                <input
                  aria-label="通过人数"
                  min={1}
                  type="number"
                  value={data.requiredApprovals ?? ''}
                  onChange={(event) => onUpdate({
                    requiredApprovals: event.target.value === ''
                      ? undefined
                      : Number(event.target.value),
                  })}
                />
              </label>
            )}
          </div>
          <div className="inspector-group">
            <span className="inspector-group-title">SLA 与升级</span>
            <div className="inspector-number-grid">
              <label className="form-field">
                <span>审核时限（分钟）</span>
                <input
                  aria-label="审核时限（分钟）"
                  min={1}
                  type="number"
                  value={data.dueMinutes ?? ''}
                  onChange={(event) => onUpdate({
                    dueMinutes: event.target.value === ''
                      ? undefined
                      : Number(event.target.value),
                  })}
                />
              </label>
              <label className="form-field">
                <span>升级时间（分钟）</span>
                <input
                  aria-label="升级时间（分钟）"
                  min={2}
                  type="number"
                  value={data.escalationMinutes ?? ''}
                  onChange={(event) => onUpdate({
                    escalationMinutes: event.target.value === ''
                      ? undefined
                      : Number(event.target.value),
                  })}
                />
              </label>
            </div>
            <label className="form-field">
              <span>升级审核组</span>
              <select
                aria-label="升级审核组"
                value={data.escalationGroupId ?? ''}
                onChange={(event) => onUpdate({
                  escalationGroupId: event.target.value || undefined,
                })}
              >
                <option value="">使用平台默认升级组</option>
                {reviewGroups.filter((group) => group.isEscalationGroup).map((group) => (
                  <option value={group.id} key={group.id}>{group.name}</option>
                ))}
              </select>
            </label>
          </div>
        </>
      )}
      <label className="form-field"><span>节点说明</span><input value={data.subtitle} onChange={(event) => onUpdate({ subtitle: event.target.value })} /></label>
      <div className="inspector-section">
        <div><span>节点类型</span><strong>{data.kind}</strong></div>
        <div><span>持久化状态</span><strong>随草稿保存</strong></div>
        <div><span>发布约束</span><strong>{isAgent ? '必须引用版本' : isHuman ? '必须配置审核规则' : 'DAG 校验'}</strong></div>
      </div>
      <div className="inspector-section" aria-label="删除影响">
        <div><span>删除影响</span><strong>共影响 {edgeImpact.total} 条连线</strong></div>
        <div><span>入边 {edgeImpact.incoming}</span><strong>上游输入</strong></div>
        <div><span>出边 {edgeImpact.outgoing}</span><strong>下游输出</strong></div>
      </div>
      <button className="button secondary full" onClick={onDuplicate}><Copy size={14} />复制节点</button>
      {isConfirmingDelete ? (
        <div className="inspector-delete-confirm">
          <strong>确认删除该节点？</strong>
          <p>{edgeImpact.total > 0 ? `将同时移除 ${edgeImpact.total} 条关联连线。` : '该节点没有关联连线。'}</p>
          <div className="inspector-confirm-actions">
            <button className="button ghost full" onClick={() => setIsConfirmingDelete(false)}>取消删除</button>
            <button className="button danger full" onClick={onDelete}><Trash2 size={14} />确认删除节点</button>
          </div>
        </div>
      ) : (
        <button className="button danger full" onClick={() => setIsConfirmingDelete(true)}><Trash2 size={14} />删除节点</button>
      )}
    </aside>
  )
}

function EdgeInspector({
  edge,
  nodes,
  onClose,
  onDelete,
}: {
  edge: Edge
  nodes: Node[]
  onClose: () => void
  onDelete: () => void
}) {
  const sourceNode = nodes.find((node) => node.id === edge.source)
  const targetNode = nodes.find((node) => node.id === edge.target)
  const sourceData = sourceNode?.data as WorkflowNodeData | undefined
  const targetData = targetNode?.data as WorkflowNodeData | undefined
  const sourceLabel = sourceData?.label ?? edge.source
  const targetLabel = targetData?.label ?? edge.target

  return (
    <aside className="node-inspector edge-inspector">
      <header>
        <div>
          <span className="section-kicker">EDGE</span>
          <h3>连线配置</h3>
        </div>
        <button onClick={onClose}>×</button>
      </header>
      <div className="inspector-section">
        <div><span>上游节点</span><strong>{sourceLabel}</strong></div>
        <div><span>下游节点</span><strong>{targetLabel}</strong></div>
        <div><span>连线 ID</span><strong>{edge.id}</strong></div>
      </div>
      <div className="inspector-section">
        <div><span>持久化状态</span><strong>随草稿保存</strong></div>
        <div><span>删除影响</span><strong>仅移除当前连线</strong></div>
      </div>
      <button className="button danger full" onClick={onDelete}><Trash2 size={14} />删除连线</button>
    </aside>
  )
}
