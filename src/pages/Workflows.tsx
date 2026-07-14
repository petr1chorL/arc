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
import { useNavigate, useParams } from 'react-router-dom'
import {
  Beaker,
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
  PencilLine,
  Plus,
  Play,
  Save,
  Search,
  Send,
  ShieldAlert,
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
import { getRubrics, listRubricVersions } from '../api/evaluations'
import { listModelProviders } from '../api/modelProviders'
import {
  createWorkflow,
  deleteWorkflow,
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
  ModelProvider,
  Rubric,
  RubricVersion,
  WorkflowRubricRef,
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
  { label: '评估', icon: Beaker, kind: 'evaluation' },
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

interface WorkflowEvaluationTemplateOption {
  rubricId: string
  rubricName: string
  versionId: string
  version: string
  snapshot: Rubric
  providerId: string
  providerName: string
  model: string
}

type EvaluationTemplateLoadState = 'loading' | 'ready' | 'error'

function evaluationTemplateOptionValue(option: WorkflowEvaluationTemplateOption) {
  return `${option.rubricId}|${option.versionId}`
}

function evaluationRubricRefValue(rubricRef?: WorkflowRubricRef) {
  return rubricRef ? `${rubricRef.rubricId}|${rubricRef.versionId}` : ''
}

function isCompleteEvaluationProvider(provider: ModelProvider) {
  return provider.status !== 'disabled'
    && Boolean(provider.id.trim())
    && Boolean(provider.name.trim())
    && Boolean(provider.baseUrl.trim())
    && Boolean(provider.defaultModel.trim())
    && Boolean(provider.secretRef.trim())
}

function hasWorkflowCompatibleDimensions(rubric: Rubric) {
  if (rubric.dimensions.length === 0) return false
  const ids = new Set<string>()
  const names = new Set<string>()
  let totalWeight = 0
  for (const dimension of rubric.dimensions) {
    const id = dimension.id?.trim() ?? ''
    const name = dimension.name.trim()
    const normalizedName = name.toLocaleLowerCase('zh-CN')
    const criteria = dimension.criteria?.trim() ?? ''
    if (!id || !name || !criteria || ids.has(id) || names.has(normalizedName)) return false
    if (!Number.isInteger(dimension.weight) || dimension.weight < 1 || dimension.weight > 100) return false
    ids.add(id)
    names.add(normalizedName)
    totalWeight += dimension.weight
  }
  return totalWeight === 100
}

function toWorkflowEvaluationTemplateOption(
  rubric: Rubric,
  version: RubricVersion,
  providersById: Map<string, ModelProvider>,
): WorkflowEvaluationTemplateOption | null {
  const snapshot = version.snapshot
  const providerId = snapshot.modelProviderId?.trim() ?? ''
  const provider = providersById.get(providerId)
  if (snapshot.judgeType !== 'llm' || !snapshot.judgeModel.trim()) return null
  if (!provider || !hasWorkflowCompatibleDimensions(snapshot)) return null
  return {
    rubricId: rubric.id,
    rubricName: snapshot.name.trim() || rubric.name,
    versionId: version.id,
    version: version.version,
    snapshot,
    providerId,
    providerName: provider.name,
    model: snapshot.judgeModel.trim(),
  }
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

interface EdgeFieldMapping {
  sourcePath: string
  targetPath: string
}

type RunSchemaFieldType = 'string' | 'number' | 'integer' | 'boolean'

interface RunSchemaField {
  name: string
  label: string
  type: RunSchemaFieldType
  required: boolean
}

type PendingWorkflowNavigation =
  | { kind: 'new' }
  | { kind: 'activate'; workflowId: string }

type RuntimeNodeStatus = NonNullable<WorkflowNodeData['status']>

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

function mapRunNodeStatus(status: string): RuntimeNodeStatus {
  switch (displayStatus(status)) {
    case '已完成':
    case '已通过':
    case '修改后通过':
      return 'success'
    case '需介入':
    case '等待审核':
    case '待认领':
    case '审核中':
      return 'warning'
    case '失败':
    case '恢复失败':
      return 'error'
    case '运行中':
    case '排队中':
      return 'running'
    default:
      return 'idle'
  }
}

function getRunStatusLabel(run: ExecutionRun) {
  const status = displayStatus(run.status)
  if (status === '已完成') return '运行完成'
  if (status === '失败') return '运行失败'
  if (isWaitingForHumanReview(status)) return '等待人工审核处理'
  if (status === '运行中' && run.currentNode) return `正在运行：${run.currentNode}`
  return status
}

function applyRunNodeStatuses(nodes: Node[], run: ExecutionRun | null) {
  if (!run) return nodes
  const statuses = new Map<string, RuntimeNodeStatus>()
  for (const nodeRun of Array.isArray(run.nodes) ? run.nodes : []) {
    statuses.set(nodeRun.nodeId, mapRunNodeStatus(nodeRun.status))
  }
  const runStatus = displayStatus(run.status)
  if (runStatus === '已完成') {
    for (const node of nodes) {
      const data = node.data as WorkflowNodeData
      if (data.kind === 'end' && !statuses.has(node.id)) statuses.set(node.id, 'success')
    }
  }
  if (statuses.size === 0 && run.currentNode) {
    const fallbackStatus = runStatus === '失败'
      ? 'error'
      : isWaitingForHumanReview(runStatus)
        ? 'warning'
        : 'running'
    for (const node of nodes) {
      const data = node.data as WorkflowNodeData
      if (data.label === run.currentNode) statuses.set(node.id, fallbackStatus)
    }
  }
  return nodes.map((node) => {
    const runtimeStatus = statuses.get(node.id)
    if (!runtimeStatus) return node
    const nextData = {
      ...node.data,
      status: runtimeStatus,
    }
    return {
      ...node,
      className: `runtime-${runtimeStatus}`,
      data: nextData,
    }
  })
}

function createPendingWorkflowRun(
  workflow: WorkflowDraft | undefined,
  workflowId: string,
  workflowVersion: string | undefined,
  input: string,
  nodes: Node[],
): ExecutionRun {
  const now = new Date().toISOString()
  const firstRuntimeNode = nodes.find((node) => {
    const data = node.data as WorkflowNodeData
    return data.kind !== 'trigger' && data.kind !== 'end'
  }) ?? nodes.find((node) => {
    const data = node.data as WorkflowNodeData
    return data.kind !== 'end'
  })
  const firstRuntimeData = firstRuntimeNode?.data as WorkflowNodeData | undefined

  return {
    id: 'pending-run',
    kind: 'workflow',
    name: workflow?.name ?? '当前工作流',
    workflowId,
    workflowVersion: workflowVersion ?? null,
    agentId: null,
    agentVersion: null,
    status: '运行中',
    input,
    output: '',
    score: null,
    model: '',
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    durationMs: 0,
    currentNode: firstRuntimeData?.label ?? '启动中',
    error: '',
    startedAt: now,
    completedAt: null,
    nodes: firstRuntimeNode && firstRuntimeData
      ? [{
        id: `pending-${firstRuntimeNode.id}`,
        nodeId: firstRuntimeNode.id,
        nodeType: firstRuntimeData.kind,
        nodeName: firstRuntimeData.label,
        status: '运行中',
        input,
        output: '',
        model: '',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        durationMs: 0,
        attempts: 1,
        score: null,
        error: '',
        startedAt: now,
        completedAt: null,
      }]
      : [],
  }
}

function markPendingRunFailed(run: ExecutionRun, message: string): ExecutionRun {
  const completedAt = new Date().toISOString()
  return {
    ...run,
    status: '失败',
    error: message,
    completedAt,
    nodes: run.nodes.map((node) => ({
      ...node,
      status: '失败',
      error: message,
      completedAt,
    })),
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

function defaultWorkflowSchema() {
  return { type: 'object', properties: {} }
}

function schemaToText(schema: Record<string, unknown> | undefined) {
  return JSON.stringify(schema ?? defaultWorkflowSchema(), null, 2)
}

function parseWorkflowSchema(label: string, text: string) {
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: `${label} 必须是 JSON 对象` }
    }
    return { value: parsed as Record<string, unknown> }
  } catch {
    return { error: `${label} 必须是合法 JSON` }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getSchemaFieldType(value: unknown): RunSchemaFieldType | null {
  if (value === 'string' || value === 'number' || value === 'integer' || value === 'boolean') {
    return value
  }
  return null
}

function getRunSchemaFields(schema: Record<string, unknown> | undefined): RunSchemaField[] {
  if (!isRecord(schema) || schema.type !== 'object' || !isRecord(schema.properties)) {
    return []
  }
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((field): field is string => typeof field === 'string')
      : [],
  )
  return Object.entries(schema.properties).flatMap(([name, property]) => {
    if (!isRecord(property)) return []
    const fieldType = getSchemaFieldType(property.type ?? 'string')
    if (!fieldType) return []
    return [{
      name,
      label: typeof property.title === 'string' && property.title.trim() ? property.title.trim() : name,
      type: fieldType,
      required: required.has(name),
    }]
  })
}

function buildSchemaRunInput(
  fields: RunSchemaField[],
  values: Record<string, string | boolean>,
) {
  const payload: Record<string, unknown> = {}
  const errors: string[] = []

  fields.forEach((field) => {
    const value = values[field.name]
    if (field.type === 'boolean') {
      const checked = value === true
      if (checked || field.required) payload[field.name] = checked
      return
    }

    const text = typeof value === 'string' ? value.trim() : ''
    if (!text) {
      if (field.required) errors.push(`${field.label} 为必填项`)
      return
    }

    if (field.type === 'number' || field.type === 'integer') {
      const numericValue = Number(text)
      if (!Number.isFinite(numericValue)) {
        errors.push(`${field.label} 必须是数字`)
        return
      }
      if (field.type === 'integer' && !Number.isInteger(numericValue)) {
        errors.push(`${field.label} 必须是整数`)
        return
      }
      payload[field.name] = numericValue
      return
    }

    payload[field.name] = text
  })

  return {
    errors,
    input: JSON.stringify(payload),
  }
}

function buildSimpleRunInput(text: string, fields: RunSchemaField[]) {
  const trimmed = text.trim()
  if (!trimmed || fields.length === 0) return trimmed

  const requiredTextFields = fields.filter((field) => field.required && field.type === 'string')
  const preferredTaskField = fields.find((field) => (
    field.type === 'string'
    && ['task', 'input', 'prompt', 'query', 'brief', 'sourceNotes', 'businessContext', 'desiredOutput'].includes(field.name)
  ))
  const payload: Record<string, unknown> = {}

  requiredTextFields.forEach((field) => {
    payload[field.name] = trimmed
  })
  if (preferredTaskField && !(preferredTaskField.name in payload)) {
    payload[preferredTaskField.name] = trimmed
  }
  if (Object.keys(payload).length === 0) {
    payload.task = trimmed
  }

  return JSON.stringify(payload)
}

function getRunFormTextValue(value: string | boolean | undefined) {
  return typeof value === 'string' ? value : ''
}

function getEdgeFieldMappings(edge: Edge): EdgeFieldMapping[] {
  const mappings = edge.data?.mappings
  if (!Array.isArray(mappings)) return []
  return mappings.map((mapping) => {
    if (!mapping || typeof mapping !== 'object') {
      return { sourcePath: '', targetPath: '' }
    }
    const candidate = mapping as Record<string, unknown>
    return {
      sourcePath: typeof candidate.sourcePath === 'string' ? candidate.sourcePath : '',
      targetPath: typeof candidate.targetPath === 'string' ? candidate.targetPath : '',
    }
  })
}

function withEdgeFieldMappings(edge: Edge, mappings: EdgeFieldMapping[]): Edge {
  return {
    ...edge,
    data: {
      ...(edge.data ?? {}),
      mappings,
    },
  }
}

function collectEdgeMappingErrors(edges: Edge[]) {
  return edges.flatMap((edge) => getEdgeFieldMappings(edge).flatMap((mapping, index) => {
    const sourcePath = mapping.sourcePath.trim()
    const targetPath = mapping.targetPath.trim()
    if (!sourcePath || !targetPath) {
      return [`连线 ${edge.id} 的第 ${index + 1} 条映射必须同时填写上游字段和下游字段`]
    }
    return []
  }))
}

function createDraftSignature(
  name: string,
  nodes: Node[],
  edges: Edge[],
  inputSchemaText: string,
  outputSchemaText: string,
) {
  return JSON.stringify({
    name: name.trim() || '未命名工作流',
    inputSchemaText,
    outputSchemaText,
    ...toContractGraph(sanitizeWorkflowNodes(nodes), edges),
  })
}

export function Workflows() {
  const { workspace, workspacePath } = useWorkspace()
  const navigate = useNavigate()
  const { workflowId: routeWorkflowId } = useParams()
  const reactFlowRef = useRef<ReactFlowInstance | null>(null)
  const [nodes, setNodes, onNodesChange] = useNodesState(createDefaultNodes())
  const [edges, setEdges, onEdgesChange] = useEdgesState(createDefaultEdges())
  const [workflows, setWorkflows] = useState<WorkflowDraft[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [name, setName] = useState('未命名工作流')
  const [isRenamingWorkflow, setIsRenamingWorkflow] = useState(false)
  const [workflowNameDraft, setWorkflowNameDraft] = useState('未命名工作流')
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null)
  const [agentOptions, setAgentOptions] = useState<PublishedAgentOption[]>([])
  const [evaluationTemplateOptions, setEvaluationTemplateOptions] = useState<WorkflowEvaluationTemplateOption[]>([])
  const [evaluationTemplateLoadState, setEvaluationTemplateLoadState] = useState<EvaluationTemplateLoadState>('loading')
  const [reviewers, setReviewers] = useState<Reviewer[]>([])
  const [reviewGroups, setReviewGroups] = useState<ReviewGroup[]>([])
  const [versions, setVersions] = useState<WorkflowVersion[]>([])
  const [showVersions, setShowVersions] = useState(false)
  const [versionDialogWorkflowName, setVersionDialogWorkflowName] = useState('')
  const [versionLoadError, setVersionLoadError] = useState('')
  const [isLoadingVersions, setIsLoadingVersions] = useState(false)
  const [showPublishNote, setShowPublishNote] = useState(false)
  const [publishNote, setPublishNote] = useState('')
  const [publishNoteError, setPublishNoteError] = useState('')
  const [workflowDeleteCandidate, setWorkflowDeleteCandidate] = useState<WorkflowDraft | null>(null)
  const [showRun, setShowRun] = useState(false)
  const [showAdvancedRunInput, setShowAdvancedRunInput] = useState(false)
  const [runInput, setRunInput] = useState('')
  const [runFormValues, setRunFormValues] = useState<Record<string, string | boolean>>({})
  const [runResult, setRunResult] = useState<ExecutionRun | null>(null)
  const [inputSchemaText, setInputSchemaText] = useState(schemaToText(defaultWorkflowSchema()))
  const [outputSchemaText, setOutputSchemaText] = useState(schemaToText(defaultWorkflowSchema()))
  const [feedback, setFeedback] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [isBusy, setIsBusy] = useState(false)
  const [savedDraftSignature, setSavedDraftSignature] = useState('')
  const [pendingNavigation, setPendingNavigation] = useState<PendingWorkflowNavigation | null>(null)
  const [keyboardDeleteNode, setKeyboardDeleteNode] = useState<Node | null>(null)
  const [undoStack, setUndoStack] = useState<CanvasSnapshot[]>([])
  const [redoStack, setRedoStack] = useState<CanvasSnapshot[]>([])
  const sanitizedNodes = useMemo(() => sanitizeWorkflowNodes(nodes), [nodes])
  const renderedNodes = useMemo(() => applyRunNodeStatuses(sanitizedNodes, runResult), [runResult, sanitizedNodes])
  const draftSignature = useMemo(
    () => createDraftSignature(name, sanitizedNodes, edges, inputSchemaText, outputSchemaText),
    [edges, inputSchemaText, name, outputSchemaText, sanitizedNodes],
  )
  const hasUnsavedChanges = savedDraftSignature !== '' && draftSignature !== savedDraftSignature
  const isEditorRoute = Boolean(routeWorkflowId)

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
    setWorkflowNameDraft(workflow.name)
    setIsRenamingWorkflow(false)
    setNodes(graph.nodes)
    setEdges(graph.edges)
    const nextInputSchemaText = schemaToText(workflow.inputSchema)
    const nextOutputSchemaText = schemaToText(workflow.outputSchema)
    setInputSchemaText(nextInputSchemaText)
    setOutputSchemaText(nextOutputSchemaText)
    setSavedDraftSignature(createDraftSignature(
      workflow.name,
      graph.nodes,
      graph.edges,
      nextInputSchemaText,
      nextOutputSchemaText,
    ))
    setSelectedNode(null)
    setSelectedEdge(null)
    setPendingNavigation(null)
    setKeyboardDeleteNode(null)
    setRunResult(null)
    resetCanvasHistory()
    setFeedback('')
    setErrors([])
    void listWorkflowVersions(workspace.id, workflow.id)
      .then(setVersions)
      .catch(() => setVersions([]))
  }, [resetCanvasHistory, setEdges, setNodes, workspace.id])

  const resetToNewWorkflow = useCallback(() => {
    const defaultNodes = createDefaultNodes()
    const defaultEdges = createDefaultEdges()
    const defaultInputSchemaText = schemaToText(defaultWorkflowSchema())
    const defaultOutputSchemaText = schemaToText(defaultWorkflowSchema())
    setCurrentId(null)
    setName('未命名工作流')
    setWorkflowNameDraft('未命名工作流')
    setIsRenamingWorkflow(false)
    setNodes(defaultNodes)
    setEdges(defaultEdges)
    setInputSchemaText(defaultInputSchemaText)
    setOutputSchemaText(defaultOutputSchemaText)
    setSavedDraftSignature(createDraftSignature(
      '未命名工作流',
      defaultNodes,
      defaultEdges,
      defaultInputSchemaText,
      defaultOutputSchemaText,
    ))
    resetCanvasHistory()
    setSelectedNode(null)
    setSelectedEdge(null)
    setPendingNavigation(null)
    setKeyboardDeleteNode(null)
    setRunResult(null)
    setVersions([])
    setVersionDialogWorkflowName('')
    setVersionLoadError('')
    setErrors([])
    setFeedback('')
  }, [resetCanvasHistory, setEdges, setNodes])

  const openWorkflowVersionsFor = useCallback(async (workflow: WorkflowDraft) => {
    setVersionDialogWorkflowName(workflow.name)
    setVersions([])
    setVersionLoadError('')
    setShowVersions(true)
    setIsLoadingVersions(true)
    setErrors([])
    try {
      const nextVersions = await listWorkflowVersions(workspace.id, workflow.id)
      setVersions(nextVersions)
    } catch {
      setVersions([])
      setVersionLoadError('版本记录加载失败')
    } finally {
      setIsLoadingVersions(false)
    }
  }, [workspace.id])

  const openPublishNoteDialog = useCallback(() => {
    setPublishNote('')
    setPublishNoteError('')
    setShowPublishNote(true)
    setErrors([])
  }, [])

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
      const routedWorkflow = routeWorkflowId && routeWorkflowId !== 'new'
        ? savedWorkflows.find((workflow) => workflow.id === routeWorkflowId)
        : null
      if (routeWorkflowId === 'new') {
        resetToNewWorkflow()
      } else if (routedWorkflow) {
        activateWorkflow(routedWorkflow)
      } else if (!routeWorkflowId && savedWorkflows[0]) {
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
  }, [activateWorkflow, resetToNewWorkflow, routeWorkflowId, workspace.id])

  const currentWorkflow = workflows.find((workflow) => workflow.id === currentId)

  useEffect(() => {
    let isActive = true
    setEvaluationTemplateOptions([])
    setEvaluationTemplateLoadState('loading')

    async function loadEvaluationTemplates() {
      try {
        const [rubrics, providers] = await Promise.all([
          getRubrics(workspace.id),
          listModelProviders(workspace.id),
        ])
        const providersById = new Map(
          providers
            .filter(isCompleteEvaluationProvider)
            .map((provider) => [provider.id, provider]),
        )
        const versionGroups = await Promise.all(
          rubrics
            .filter((rubric) => rubric.status === 'active')
            .map(async (rubric) => ({
              rubric,
              versions: await listRubricVersions(workspace.id, rubric.id),
            })),
        )
        const options = versionGroups.flatMap(({ rubric, versions: publishedVersions }) => (
          publishedVersions.flatMap((version) => {
            const option = toWorkflowEvaluationTemplateOption(rubric, version, providersById)
            return option ? [option] : []
          })
        ))
        if (!isActive) return
        setEvaluationTemplateOptions(options)
        setEvaluationTemplateLoadState('ready')
      } catch {
        if (!isActive) return
        setEvaluationTemplateOptions([])
        setEvaluationTemplateLoadState('error')
      }
    }

    void loadEvaluationTemplates()
    return () => {
      isActive = false
    }
  }, [workspace.id])
  const requestWorkflowDelete = useCallback(() => {
    if (!currentWorkflow) return
    setWorkflowDeleteCandidate(currentWorkflow)
    setErrors([])
  }, [currentWorkflow])
  const runSchemaFields = useMemo(
    () => getRunSchemaFields(currentWorkflow?.inputSchema),
    [currentWorkflow?.inputSchema],
  )
  const hasRunSchemaForm = runSchemaFields.length > 0
  const statusText = currentWorkflow
    ? `${displayStatus(currentWorkflow.status)} · ${currentWorkflow.version}`
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
      const parsedInputSchema = parseWorkflowSchema('工作流输入 Schema', inputSchemaText)
      const parsedOutputSchema = parseWorkflowSchema('工作流输出 Schema', outputSchemaText)
      const schemaErrors = [parsedInputSchema.error, parsedOutputSchema.error].filter(Boolean) as string[]
      const edgeMappingErrors = collectEdgeMappingErrors(edges)
      const validationErrors = [...schemaErrors, ...edgeMappingErrors]
      if (validationErrors.length > 0 || !parsedInputSchema.value || !parsedOutputSchema.value) {
        setErrors(validationErrors)
        return null
      }
      const graph = toContractGraph(sanitizedNodes, edges)
      const input = {
        name: name.trim() || '未命名工作流',
        inputSchema: parsedInputSchema.value,
        outputSchema: parsedOutputSchema.value,
        ...graph,
      }
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
      const savedInputSchemaText = schemaToText(saved.inputSchema)
      const savedOutputSchemaText = schemaToText(saved.outputSchema)
      setInputSchemaText(savedInputSchemaText)
      setOutputSchemaText(savedOutputSchemaText)
      setSavedDraftSignature(createDraftSignature(
        saved.name,
        savedGraph.nodes,
        savedGraph.edges,
        savedInputSchemaText,
        savedOutputSchemaText,
      ))
      resetCanvasHistory()
      setFeedback('工作流草稿已保存')
      return saved
    } catch (saveError) {
      setErrors([saveError instanceof Error ? saveError.message : '工作流保存失败'])
      return null
    } finally {
      setIsBusy(false)
    }
  }, [currentId, edges, inputSchemaText, name, outputSchemaText, resetCanvasHistory, sanitizedNodes, workspace.id])

  async function publish(note: string) {
    const trimmedNote = note.trim()
    const saved = await saveDraft()
    if (!saved) return
    setIsBusy(true)
    try {
      const validation = await validateWorkflow(workspace.id, saved.id)
      if (!validation.valid) {
        setErrors(validation.errors)
        return
      }
      const version = await publishWorkflow(workspace.id, saved.id, { note: trimmedNote })
      setVersions((current) => [version, ...current])
      setWorkflows((current) => current.map((workflow) => (
        workflow.id === saved.id
          ? { ...workflow, status: '已发布', version: version.version }
          : workflow
      )))
      setFeedback(`${version.version} 已发布`)
      setShowPublishNote(false)
      setPublishNote('')
      setPublishNoteError('')
      setErrors([])
    } catch (publishError) {
      setErrors([publishError instanceof Error ? publishError.message : '工作流发布失败'])
    } finally {
      setIsBusy(false)
    }
  }

  async function executeWorkflow() {
    const schemaRunInput = showAdvancedRunInput && hasRunSchemaForm
      ? buildSchemaRunInput(runSchemaFields, runFormValues)
      : null
    if (schemaRunInput?.errors.length) {
      setErrors(schemaRunInput.errors)
      return
    }
    const nextRunInput = schemaRunInput?.input ?? buildSimpleRunInput(runInput, runSchemaFields)
    if (!currentId || !nextRunInput) {
      setErrors(['请输入运行任务'])
      return
    }
    const pendingRun = createPendingWorkflowRun(
      currentWorkflow,
      currentId,
      currentWorkflow?.version,
      nextRunInput,
      sanitizedNodes,
    )
    setIsBusy(true)
    setErrors([])
    setRunResult(pendingRun)
    setShowRun(false)
    setFeedback(getRunStatusLabel(pendingRun))
    try {
      const result = await runWorkflow(workspace.id, currentId, {
        input: nextRunInput,
        version: currentWorkflow?.version,
      })
      setRunResult(result)
      setFeedback(getRunStatusLabel(result))
      navigate(workspacePath(`runs?runId=${encodeURIComponent(result.id)}`))
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : '工作流运行失败'
      setRunResult(markPendingRunFailed(pendingRun, message))
      setErrors([message])
      setFeedback('运行失败')
    } finally {
      setIsBusy(false)
    }
  }

  function startNewWorkflow() {
    if (hasUnsavedChanges) {
      setPendingNavigation({ kind: 'new' })
      return
    }
    resetToNewWorkflow()
    navigate(workspacePath('workflows/new'))
  }

  async function confirmPublishWithNote() {
    const trimmedNote = publishNote.trim()
    if (!trimmedNote) {
      setPublishNoteError('请填写发布备注')
      return
    }
    await publish(trimmedNote)
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

  function openWorkflowEditor(workflowId: string) {
    const needsConfirmation = workflowId !== currentId && hasUnsavedChanges
    requestWorkflowActivation(workflowId)
    if (!needsConfirmation) {
      navigate(workspacePath(`workflows/${workflowId}`))
    }
  }

  async function confirmWorkflowDelete() {
    if (!workflowDeleteCandidate) return
    setIsBusy(true)
    setErrors([])
    try {
      await deleteWorkflow(workspace.id, workflowDeleteCandidate.id)
      setWorkflows((current) => current.filter((workflow) => workflow.id !== workflowDeleteCandidate.id))
      setWorkflowDeleteCandidate(null)
      resetToNewWorkflow()
      navigate(workspacePath('/workflows'))
      setFeedback(`工作流「${workflowDeleteCandidate.name}」已删除`)
    } catch (deleteError) {
      setErrors([deleteError instanceof Error ? deleteError.message : '工作流删除失败'])
    } finally {
      setIsBusy(false)
    }
  }

  function openWorkflowRunDialogFor(workflow: WorkflowDraft) {
    if (workflow.id !== currentId) {
      if (hasUnsavedChanges) {
        setPendingNavigation({ kind: 'activate', workflowId: workflow.id })
        return
      }
      activateWorkflow(workflow)
    }
    setRunResult(null)
    setRunInput('')
    setRunFormValues({})
    setErrors([])
    setShowAdvancedRunInput(false)
    setShowRun(true)
  }

  function continueAfterDiscardingChanges() {
    if (!pendingNavigation) return
    if (pendingNavigation.kind === 'new') {
      resetToNewWorkflow()
      navigate(workspacePath('workflows/new'))
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
          subtitle: kind === 'agent'
            ? '尚未绑定发布版本'
            : kind === 'evaluation'
            ? '请选择已发布评估模板'
            : kind === 'human'
            ? '指定用户审核'
            : '待配置',
          kind,
          status: kind === 'agent' || kind === 'evaluation' ? 'warning' : 'idle',
          ...(kind === 'human'
            ? {
              assignmentType: 'direct_reviewer',
              reviewPolicy: 'any_one',
              requiredApprovals: 1,
              reviewerIds: [],
            }
            : {}),
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

  function updateSelectedEdgeMappings(nextMappings: EdgeFieldMapping[]) {
    if (!selectedEdge) return
    const applyMappings = (edge: Edge) => (
      edge.id === selectedEdge.id ? withEdgeFieldMappings(edge, nextMappings) : edge
    )
    setEdges((current) => current.map(applyMappings))
    setSelectedEdge((current) => current ? withEdgeFieldMappings(current, nextMappings) : current)
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

  function startRenamingWorkflow() {
    setWorkflowNameDraft(name)
    setIsRenamingWorkflow(true)
  }

  function confirmWorkflowName() {
    const nextName = workflowNameDraft.trim() || '未命名工作流'
    setName(nextName)
    setWorkflowNameDraft(nextName)
    setIsRenamingWorkflow(false)
  }

  function cancelWorkflowName() {
    setWorkflowNameDraft(name)
    setIsRenamingWorkflow(false)
  }

  return (
    <div className="workflow-studio">
      {feedback && <div className="toast"><Check size={16} />{feedback}</div>}
      {!isEditorRoute && (
      <section className="workflow-directory-panel" aria-label="工作流列表">
        <div className="workflow-directory-header">
          <div>
            <span className="eyebrow">WORKFLOW DIRECTORY</span>
            <h2>工作流列表</h2>
            <p>先选择一个工作流，再进入编排画布维护节点、连线和发布版本。</p>
          </div>
          <button className="button secondary" type="button" onClick={startNewWorkflow}>
            <FilePlus2 size={15} />新建工作流
          </button>
        </div>
        <div className="workflow-directory-list">
          {workflows.length === 0 ? (
            <div className="workflow-directory-empty">
              <strong>还没有工作流</strong>
              <span>新建后会在这里形成可进入编排的工作流资产。</span>
            </div>
          ) : workflows.map((workflow) => {
            const nodeCount = Array.isArray(workflow.nodes) ? workflow.nodes.length : 0
            const edgeCount = Array.isArray(workflow.edges) ? workflow.edges.length : 0
            const active = workflow.id === currentId
            return (
              <article
                className={`workflow-directory-row ${active ? 'active' : ''}`}
                key={workflow.id}
              >
                <div className="workflow-directory-main">
                  <span>{active ? '当前编排中' : '工作流资产'}</span>
                  <strong>{workflow.name}</strong>
                  <small>{new Date(workflow.updatedAt).toLocaleString('zh-CN')} 更新</small>
                </div>
                <div className="workflow-directory-meta" aria-label={`${workflow.name} 元信息`}>
                  <span><small>状态</small><strong>{displayStatus(workflow.status)}</strong></span>
                  <span><small>版本</small><strong>{workflow.version}</strong></span>
                  <span><small>节点</small><strong>{nodeCount} 个节点</strong></span>
                  <span><small>连线</small><strong>{edgeCount} 条连线</strong></span>
                </div>
                <div className="workflow-directory-actions">
                  <button
                    aria-label={`查看版本记录 ${workflow.name}`}
                    className="button ghost compact"
                    type="button"
                    onClick={() => void openWorkflowVersionsFor(workflow)}
                  >
                    <History size={14} />版本记录
                  </button>
                  <button
                    aria-label={`运行 ${workflow.name}`}
                    className="button secondary compact"
                    disabled={workflow.version === '未发布' || isBusy}
                    type="button"
                    onClick={() => openWorkflowRunDialogFor(workflow)}
                  >
                    <Play size={14} />运行
                  </button>
                  <button
                    aria-label={`编辑 ${workflow.name}`}
                    className="button primary compact"
                    type="button"
                    onClick={() => openWorkflowEditor(workflow.id)}
                  >
                    <PencilLine size={14} />编辑
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      </section>
      )}
      {isEditorRoute && (
      <>
      <div className="workflow-editor-return">
        <button className="button ghost" type="button" onClick={() => navigate(workspacePath('workflows'))}>
          返回工作流列表
        </button>
      </div>
      <div className="studio-toolbar">
        <div className="workflow-title">
          <button className="workflow-icon" type="button" title="当前工作流"><GitBranch size={18} /></button>
          <div className="workflow-name-field">
            <span className="workflow-name-label">当前工作流</span>
            {isRenamingWorkflow ? (
              <div className="workflow-name-edit-row">
                <input
                  aria-label="工作流名称"
                  autoFocus
                  placeholder="输入工作流名称"
                  value={workflowNameDraft}
                  onChange={(event) => setWorkflowNameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') confirmWorkflowName()
                    if (event.key === 'Escape') cancelWorkflowName()
                  }}
                />
                <button className="button primary compact" type="button" onClick={confirmWorkflowName}>确认</button>
                <button className="button ghost compact" type="button" onClick={cancelWorkflowName}>取消</button>
              </div>
            ) : (
              <div className="workflow-name-view-row">
                <strong aria-label="工作流名称">{name}</strong>
                <span>{statusText}</span>
                <button className="button ghost compact" type="button" onClick={startRenamingWorkflow}>
                  <PencilLine size={14} />更改名称
                </button>
              </div>
            )}
          </div>
          {workflows.length > 0 && (
            <label className="workflow-switch-field">
              <span>切换已有工作流</span>
              <select
                aria-label="切换工作流"
                value={currentId ?? ''}
                onChange={(event) => requestWorkflowActivation(event.target.value)}
              >
                {currentId === null && <option value="">新草稿</option>}
                {workflows.map((workflow) => <option value={workflow.id} key={workflow.id}>{workflow.name}</option>)}
              </select>
            </label>
          )}
        </div>
        <div className="studio-actions">
          <button className="button ghost" title="撤销上一步画布编辑" disabled={undoStack.length === 0} onClick={undoCanvasChange}><Undo2 size={15} />撤销</button>
          <button className="button ghost" title="重做刚撤销的画布编辑" disabled={redoStack.length === 0} onClick={redoCanvasChange}><Redo2 size={15} />重做</button>
          <button className="button ghost" title="新建工作流" onClick={startNewWorkflow}><FilePlus2 size={15} />新建</button>
          <button
            className="button ghost"
            title="查看版本记录"
            disabled={!currentId}
            onClick={() => {
              const workflow = workflows.find((item) => item.id === currentId)
              if (workflow) void openWorkflowVersionsFor(workflow)
            }}
          >
            <History size={15} />版本记录
          </button>
          <button
            className="button ghost"
            title="删除当前工作流"
            disabled={!currentWorkflow || isBusy}
            onClick={requestWorkflowDelete}
          >
            <Trash2 size={15} />删除工作流
          </button>
          <button className="button ghost" title="保存工作流草稿" disabled={isBusy} onClick={() => void saveDraft()}><Save size={15} />保存草稿</button>
          <button className="button ghost" title="发布工作流版本" disabled={isBusy} onClick={openPublishNoteDialog}><Send size={15} />发布版本</button>
          <button
            className="button ghost"
            title="运行已发布工作流"
            disabled={!currentWorkflow || currentWorkflow.version === '未发布' || isBusy}
            onClick={() => {
              setRunResult(null)
              setRunInput('')
              setRunFormValues({})
              setErrors([])
              setShowAdvancedRunInput(false)
              setShowRun(true)
            }}
          >
            <Play size={15} />运行工作流
          </button>
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

      {runResult && (
        <section className="workflow-runtime-strip" aria-label="当前工作流运行状态">
          <div>
            <span>当前运行</span>
            <strong>当前运行：{getRunStatusLabel(runResult)}</strong>
            <small>Run ID {runResult.id} · 当前节点 {runResult.currentNode || '未返回'}</small>
          </div>
          <span className="runtime-status-pill">{displayStatus(runResult.status)}</span>
          <div className="workflow-runtime-legend" aria-label="节点运行状态图例">
            <span><i className="success" />通过</span>
            <span><i className="warning" />等待</span>
            <span><i className="error" />报错</span>
          </div>
          {isWaitingForHumanReview(runResult.status) && (
            <div className="workflow-runtime-handoff">
              <strong>工作流已暂停在人工审核节点</strong>
              <span>指定审核用户可到人工审核页提交通过或驳回。</span>
              <a className="button primary" href={workspacePath('reviews')}>去人工审核处理</a>
            </div>
          )}
          {(runResult.output || runResult.error) && (
            <p className="workflow-runtime-output">{runResult.output || runResult.error}</p>
          )}
          <a className="button secondary" href={workspacePath('runs')}>查看运行记录</a>
        </section>
      )}

      <section className="workflow-contract-panel" aria-label="工作流输入输出契约">
        <div>
          <p className="eyebrow">WORKFLOW CONTRACT</p>
          <h2>输入输出 Schema</h2>
        </div>
        <label className="form-field">
          <span>工作流输入 Schema</span>
          <textarea
            rows={7}
            value={inputSchemaText}
            onChange={(event) => setInputSchemaText(event.target.value)}
          />
        </label>
        <label className="form-field">
          <span>工作流输出 Schema</span>
          <textarea
            rows={7}
            value={outputSchemaText}
            onChange={(event) => setOutputSchemaText(event.target.value)}
          />
        </label>
      </section>

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
              if (data.kind === 'human') return '#ef9f50'
              if (data.kind === 'evaluation') return '#6579a8'
              if (data.kind === 'gate') return '#2e7d6c'
              return '#707975'
            }} />
          </ReactFlow>
          <div className="canvas-status"><span className="live-dot" />{currentId ? '草稿已连接数据库' : '新草稿尚未保存'} · {nodes.length} 个节点</div>
        </div>

        {selectedNode && (
          <NodeInspector
            node={selectedNode}
            agentOptions={agentOptions}
            evaluationTemplateOptions={evaluationTemplateOptions}
            evaluationTemplateLoadState={evaluationTemplateLoadState}
            evaluationCenterPath={workspacePath('evaluations')}
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
            schemaFieldOptions={runSchemaFields}
            onClose={() => setSelectedEdge(null)}
            onDelete={removeSelectedEdge}
            onUpdateMappings={updateSelectedEdgeMappings}
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

      </>
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

      {workflowDeleteCandidate && (
        <div className="dialog-backdrop">
          <section className="agent-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-workflow-title">
            <header>
              <div>
                <p className="eyebrow">DELETE WORKFLOW</p>
                <h2 id="delete-workflow-title">删除工作流？</h2>
              </div>
              <button className="icon-button quiet" title="关闭" onClick={() => setWorkflowDeleteCandidate(null)}><X size={18} /></button>
            </header>
            <p className="dialog-copy">
              将从工作流列表中移除「{workflowDeleteCandidate.name}」。已发布版本和历史运行记录会保留用于审计追溯。
            </p>
            <div className="dialog-actions">
              <button className="button secondary" disabled={isBusy} onClick={() => setWorkflowDeleteCandidate(null)}>取消</button>
              <button className="button danger" disabled={isBusy} onClick={() => void confirmWorkflowDelete()}>
                <Trash2 size={14} />确认删除工作流
              </button>
            </div>
          </section>
        </div>
      )}

      {showPublishNote && (
        <div className="dialog-backdrop">
          <section className="agent-dialog" role="dialog" aria-modal="true" aria-labelledby="publish-note-title">
            <header>
              <div>
                <p className="eyebrow">VERSION NOTE</p>
                <h2 id="publish-note-title">发布版本备注</h2>
              </div>
              <button className="icon-button quiet" title="关闭" onClick={() => setShowPublishNote(false)}><X size={18} /></button>
            </header>
            <label className="form-field">
              <span>备注</span>
              <textarea
                aria-label="发布备注"
                rows={5}
                maxLength={500}
                value={publishNote}
                onChange={(event) => {
                  setPublishNote(event.target.value)
                  if (publishNoteError) setPublishNoteError('')
                }}
                placeholder="说明本次发布调整了哪些节点、契约或运行策略"
              />
            </label>
            {publishNoteError && <p className="danger-text">{publishNoteError}</p>}
            <div className="dialog-actions">
              <button className="button secondary" disabled={isBusy} onClick={() => setShowPublishNote(false)}>取消</button>
              <button className="button primary" disabled={isBusy} onClick={() => void confirmPublishWithNote()}>
                <Send size={14} />确认发布版本
              </button>
            </div>
          </section>
        </div>
      )}

      {showVersions && (
        <div className="dialog-backdrop">
          <section className="agent-dialog workflow-version-dialog" role="dialog" aria-modal="true" aria-labelledby="workflow-version-title">
            <header>
              <div>
                <p className="eyebrow">IMMUTABLE SNAPSHOTS</p>
                <h2 id="workflow-version-title">工作流版本记录</h2>
                {versionDialogWorkflowName && <span className="dialog-subtitle">{versionDialogWorkflowName}</span>}
              </div>
              <button className="icon-button quiet" title="关闭" onClick={() => setShowVersions(false)}><X size={18} /></button>
            </header>
            <div className="version-list">
              {isLoadingVersions && <div className="version-empty">正在加载版本记录</div>}
              {!isLoadingVersions && versionLoadError && <div className="version-empty">{versionLoadError}</div>}
              {!isLoadingVersions && !versionLoadError && versions.length === 0 && <div className="version-empty">尚未发布版本</div>}
              {versions.map((version) => (
                <article className="version-item" key={version.id}>
                  <div><strong>{version.version}</strong><span>{version.snapshot.nodes.length} 个节点</span></div>
                  <p>{version.snapshot.name}</p>
                  <p className={`version-note ${version.note?.trim() ? '' : 'empty'}`}>
                    版本备注：{version.note?.trim() || '未填写'}
                  </p>
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
            {hasRunSchemaForm ? (
              <>
              <label className="form-field">
                <span>本次任务</span>
                <textarea
                  aria-label="运行输入"
                  rows={5}
                  value={runInput}
                  onChange={(event) => setRunInput(event.target.value)}
                  placeholder="描述这次希望工作流处理的任务，例如：基于安克 AI 课程笔记，产出一版 AI 赋能工作流草案"
                />
              </label>
              <div className="schema-run-advanced">
                <button
                  className="button ghost schema-run-toggle"
                  type="button"
                  aria-expanded={showAdvancedRunInput}
                  onClick={() => setShowAdvancedRunInput((current) => !current)}
                >
                  <Wrench size={15} />高级输入字段
                </button>
                <span>默认会自动把本次任务填入必填文本字段；需要精细调试时再展开。</span>
              </div>
              {showAdvancedRunInput && (
              <div className="schema-run-form" aria-label="结构化运行输入">
                <div className="schema-run-form-header">
                  <strong>结构化运行输入</strong>
                  <span>按当前工作流输入 Schema 生成，提交时会自动转为 JSON。</span>
                </div>
                {runSchemaFields.map((field) => (
                  field.type === 'boolean' ? (
                    <label className="form-field schema-checkbox-field" key={field.name}>
                      <span>{field.label}{field.required ? '（必填）' : ''}</span>
                      <input
                        aria-label={field.label}
                        checked={runFormValues[field.name] === true}
                        type="checkbox"
                        onChange={(event) => setRunFormValues((current) => ({
                          ...current,
                          [field.name]: event.target.checked,
                        }))}
                      />
                    </label>
                  ) : (
                    <label className="form-field" key={field.name}>
                      <span>{field.label}{field.required ? '（必填）' : ''}</span>
                      <input
                        aria-label={field.label}
                        type={field.type === 'string' ? 'text' : 'number'}
                        value={getRunFormTextValue(runFormValues[field.name])}
                        onChange={(event) => setRunFormValues((current) => ({
                          ...current,
                          [field.name]: event.target.value,
                        }))}
                      />
                    </label>
                  )
                ))}
              </div>
              )}
              </>
            ) : (
              <label className="form-field">
                <span>运行输入</span>
                <textarea
                  rows={5}
                  value={runInput}
                  onChange={(event) => setRunInput(event.target.value)}
                  placeholder="输入本次工作流需要处理的任务"
                />
              </label>
            )}
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
                      <span>系统已经创建 Human Task。下一步由指定审核用户到人工审核页提交通过或驳回，运行中心会记录暂停与恢复状态。</span>
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
  evaluationTemplateOptions,
  evaluationTemplateLoadState,
  evaluationCenterPath,
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
  evaluationTemplateOptions: WorkflowEvaluationTemplateOption[]
  evaluationTemplateLoadState: EvaluationTemplateLoadState
  evaluationCenterPath: string
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
  const activeReviewers = useMemo(() => reviewers.filter((reviewer) => reviewer.isActive), [reviewers])
  const isAgent = data.kind === 'agent'
  const isHuman = data.kind === 'human'
  const isEvaluation = data.kind === 'evaluation'
  const selectedEvaluationTemplateValue = evaluationRubricRefValue(data.rubricRef)
  const selectedEvaluationTemplate = evaluationTemplateOptions.find(
    (option) => evaluationTemplateOptionValue(option) === selectedEvaluationTemplateValue,
  )
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
      {isEvaluation && (
        <div className="inspector-group evaluation-template-config">
          <span className="inspector-group-title">评估模板</span>
          {evaluationTemplateLoadState === 'loading' && (
            <div className="evaluation-template-state">
              <strong>请选择已发布评估模板</strong>
              <small>正在加载可用于工作流的模板版本…</small>
            </div>
          )}
          {evaluationTemplateLoadState === 'error' && (
            <div className="evaluation-template-state error" role="alert">
              <strong>评估模板加载失败</strong>
              <small>工作流仍可继续编辑，请稍后重试。</small>
            </div>
          )}
          {evaluationTemplateLoadState === 'ready' && evaluationTemplateOptions.length === 0 && (
            <div className="evaluation-template-state">
              <strong>暂无可用于工作流的已发布模板</strong>
              <small>模板需要完整维度标准，并绑定未停用的模型配置。</small>
              <a className="button secondary full" href={evaluationCenterPath}>去评估中心发布模板</a>
            </div>
          )}
          {evaluationTemplateLoadState === 'ready' && evaluationTemplateOptions.length > 0 && (
            <>
              <label className="form-field">
                <span>已发布评估模板版本</span>
                <select
                  aria-label="评估模板版本"
                  value={selectedEvaluationTemplateValue}
                  onChange={(event) => {
                    const option = evaluationTemplateOptions.find(
                      (item) => evaluationTemplateOptionValue(item) === event.target.value,
                    )
                    onUpdate(option ? {
                      rubricRef: {
                        rubricId: option.rubricId,
                        versionId: option.versionId,
                        version: option.version,
                        name: option.rubricName,
                      } satisfies WorkflowRubricRef,
                      subtitle: `${option.rubricName} · ${option.version}`,
                      status: 'idle',
                    } : {
                      rubricRef: undefined,
                      subtitle: '请选择已发布评估模板',
                      status: 'warning',
                    })
                  }}
                >
                  <option value="">请选择已发布评估模板</option>
                  {evaluationTemplateOptions.map((option) => (
                    <option value={evaluationTemplateOptionValue(option)} key={option.versionId}>
                      {option.rubricName} · {option.version}
                    </option>
                  ))}
                </select>
              </label>
              {selectedEvaluationTemplate && (
                <div className="evaluation-template-summary">
                  <div>
                    <span>通过分 {selectedEvaluationTemplate.snapshot.passScore}</span>
                    <span>{selectedEvaluationTemplate.providerName}</span>
                    <span>{selectedEvaluationTemplate.model}</span>
                  </div>
                  <div className="evaluation-dimension-list">
                    {selectedEvaluationTemplate.snapshot.dimensions.map((dimension) => (
                      <article key={dimension.id ?? dimension.name}>
                        <header>
                          <strong>{dimension.name}</strong>
                          <span>权重 {dimension.weight}%</span>
                        </header>
                        <p>{dimension.criteria}</p>
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {isHuman && (
        <>
          <div className="inspector-group human-reviewer-lite">
            <span className="inspector-group-title">指定审核用户</span>
            <div className="reviewer-picker-list" aria-label="指定审核用户">
              {activeReviewers.length === 0 && (
                <small>暂无可选 Reviewer。请先到成员与权限中给系统用户绑定 Reviewer 资格。</small>
              )}
              {activeReviewers.map((reviewer) => {
                const checked = (data.reviewerIds ?? []).includes(reviewer.id)
                return (
                  <label className="reviewer-picker-option" key={reviewer.id}>
                    <input
                      checked={checked}
                      type="checkbox"
                      onChange={(event) => {
                        const currentReviewerIds = data.reviewerIds ?? []
                        const nextReviewerIds = event.target.checked
                          ? Array.from(new Set([...currentReviewerIds, reviewer.id]))
                          : currentReviewerIds.filter((id) => id !== reviewer.id)
                        onUpdate({
                          assignmentType: 'direct_reviewer',
                          groupId: undefined,
                          reviewerIds: nextReviewerIds,
                          reviewPolicy: 'any_one',
                          requiredApprovals: 1,
                          subtitle: nextReviewerIds.length > 0
                            ? `${nextReviewerIds.length} 位审核用户`
                            : '指定用户审核',
                        })
                      }}
                    />
                    <span>
                      <strong>{reviewer.name}</strong>
                      <small>{reviewer.role}</small>
                    </span>
                  </label>
                )
              })}
            </div>
            <small>运行到该节点后，选中的用户会在人工审核模块看到待审任务；本版本只保留通过和驳回。</small>
          </div>
          <div className="inspector-group legacy-review-config">
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
          <div className="inspector-group legacy-review-config">
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
        <div>
          <span>发布约束</span>
          <strong>
            {isAgent ? '必须引用版本' : isEvaluation ? '必须引用模板版本' : isHuman ? '必须配置审核规则' : 'DAG 校验'}
          </strong>
        </div>
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
  schemaFieldOptions,
  onClose,
  onDelete,
  onUpdateMappings,
}: {
  edge: Edge
  nodes: Node[]
  schemaFieldOptions: RunSchemaField[]
  onClose: () => void
  onDelete: () => void
  onUpdateMappings: (mappings: EdgeFieldMapping[]) => void
}) {
  const sourceNode = nodes.find((node) => node.id === edge.source)
  const targetNode = nodes.find((node) => node.id === edge.target)
  const sourceData = sourceNode?.data as WorkflowNodeData | undefined
  const targetData = targetNode?.data as WorkflowNodeData | undefined
  const sourceLabel = sourceData?.label ?? edge.source
  const targetLabel = targetData?.label ?? edge.target
  const mappings = getEdgeFieldMappings(edge)

  function updateMapping(index: number, key: keyof EdgeFieldMapping, value: string) {
    onUpdateMappings(mappings.map((mapping, mappingIndex) => (
      mappingIndex === index ? { ...mapping, [key]: value } : mapping
    )))
  }

  function sourcePathFor(field: RunSchemaField) {
    return `$.${field.name}`
  }

  function targetPathFor(field: RunSchemaField) {
    return `$.input.${field.name}`
  }

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
      <div className="inspector-section edge-mapping-section">
        <div>
          <span>字段映射</span>
          <strong>{mappings.length} 条</strong>
        </div>
        {mappings.length === 0 && <p className="inspector-help">尚未配置字段映射。</p>}
        {mappings.map((mapping, index) => (
          <div className="edge-mapping-row" key={`mapping-${index + 1}`}>
            <label className="form-field">
              <span>{`上游字段 ${index + 1}`}</span>
              <input
                aria-label={`上游字段 ${index + 1}`}
                value={mapping.sourcePath}
                onChange={(event) => updateMapping(index, 'sourcePath', event.target.value)}
                placeholder="$.source.field"
              />
            </label>
            {schemaFieldOptions.length > 0 && (
              <label className="form-field edge-picker-field">
                <span>{`源字段快捷选择 ${index + 1}`}</span>
                <select
                  aria-label={`源字段快捷选择 ${index + 1}`}
                  value={schemaFieldOptions.some((field) => sourcePathFor(field) === mapping.sourcePath) ? mapping.sourcePath : ''}
                  onChange={(event) => {
                    if (event.target.value) updateMapping(index, 'sourcePath', event.target.value)
                  }}
                >
                  <option value="">选择输入 Schema 字段</option>
                  {schemaFieldOptions.map((field) => (
                    <option value={sourcePathFor(field)} key={`source-${field.name}`}>
                      {field.label} · {sourcePathFor(field)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="form-field">
              <span>{`下游字段 ${index + 1}`}</span>
              <input
                aria-label={`下游字段 ${index + 1}`}
                value={mapping.targetPath}
                onChange={(event) => updateMapping(index, 'targetPath', event.target.value)}
                placeholder="$.target.field"
              />
            </label>
            {schemaFieldOptions.length > 0 && (
              <label className="form-field edge-picker-field">
                <span>{`目标字段快捷选择 ${index + 1}`}</span>
                <select
                  aria-label={`目标字段快捷选择 ${index + 1}`}
                  value={schemaFieldOptions.some((field) => targetPathFor(field) === mapping.targetPath) ? mapping.targetPath : ''}
                  onChange={(event) => {
                    if (event.target.value) updateMapping(index, 'targetPath', event.target.value)
                  }}
                >
                  <option value="">选择下游输入字段</option>
                  {schemaFieldOptions.map((field) => (
                    <option value={targetPathFor(field)} key={`target-${field.name}`}>
                      input.{field.label} · {targetPathFor(field)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              className="button ghost full"
              onClick={() => onUpdateMappings(mappings.filter((_, mappingIndex) => mappingIndex !== index))}
            >
              删除映射
            </button>
          </div>
        ))}
        <button
          className="button secondary full"
          onClick={() => onUpdateMappings([...mappings, { sourcePath: '', targetPath: '' }])}
        >
          <Plus size={14} />新增映射
        </button>
      </div>
      <button className="button danger full" onClick={onDelete}><Trash2 size={14} />删除连线</button>
    </aside>
  )
}
