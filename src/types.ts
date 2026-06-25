export type AgentStatus = '在线' | '调试中' | '已停用'
export type RunStatus = '运行中' | '已完成' | '需介入' | '失败'
export type ReviewStatus = '待处理' | '处理中' | '已完成' | '已驳回'

export interface Agent {
  id: string
  name: string
  role: string
  owner: string
  model: string
  status: AgentStatus
  version: string
  passRate: number
  runs: number
  tools: string[]
  skills: string[]
  systemPrompt: string
  createdAt: string
  updatedAt: string
}

export interface AssetVersion<TSnapshot = Record<string, unknown>> {
  id: string
  version: string
  snapshot: TSnapshot
  createdAt: string
}

export type AgentVersion = AssetVersion<Agent>

export interface WorkflowNodeContract {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
}

export interface WorkflowEdgeContract {
  id: string
  source: string
  target: string
  label?: string
}

export interface WorkflowDraft {
  id: string
  name: string
  status: string
  version: string
  nodes: WorkflowNodeContract[]
  edges: WorkflowEdgeContract[]
  createdAt: string
  updatedAt: string
}

export type WorkflowVersion = AssetVersion<WorkflowDraft>

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export interface Rubric {
  id: string
  name: string
  artifact: string
  dimensions: { name: string; weight: number }[]
  gate: string
  passScore: number
  version: string
}

export interface WorkflowRun {
  id: string
  workflow: string
  status: RunStatus
  progress: number
  startedAt: string
  duration: string
  score: number | null
  cost: string
  currentNode: string
}

export interface ReviewTask {
  id: string
  title: string
  workflow: string
  node: string
  risk: '高' | '中' | '低'
  score: number
  owner: string
  deadline: string
  status: ReviewStatus
  reason: string
}

export interface NodeExecution {
  id: string
  nodeId: string
  nodeType: string
  nodeName: string
  status: RunStatus
  input: string
  output: string
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: number
  durationMs: number
  attempts: number
  score: number | null
  error: string
  startedAt: string
  completedAt: string | null
}

export interface ExecutionRun {
  id: string
  kind: 'agent' | 'workflow'
  name: string
  workflowId: string | null
  workflowVersion: string | null
  agentId: string | null
  agentVersion: string | null
  status: RunStatus
  input: string
  output: string
  score: number | null
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: number
  durationMs: number
  currentNode: string
  error: string
  startedAt: string
  completedAt: string | null
  nodes: NodeExecution[]
}

export interface HumanReview {
  id: string
  runId: string
  nodeRunId: string
  title: string
  status: ReviewStatus
  reason: string
  score: number
  createdAt: string
}
