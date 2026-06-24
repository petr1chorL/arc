export type AgentStatus = '在线' | '调试中' | '已停用'
export type RunStatus = '运行中' | '已完成' | '需介入' | '失败'
export type ReviewStatus = '待处理' | '处理中' | '已完成'

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
  updatedAt: string
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
