export type AgentStatus = '在线' | '调试中' | '已停用'
export type RunStatus = '运行中' | '已完成' | '需介入' | '失败'
export type ReviewStatus = '待处理' | '处理中' | '已完成' | '已驳回'
export type WorkspaceRole = 'viewer' | 'operator' | 'builder' | 'workspace_admin'
export type WorkspaceCapability =
  | 'asset.read'
  | 'run.read'
  | 'audit.read'
  | 'run.execute'
  | 'evaluation.run'
  | 'agent.write'
  | 'agent.publish'
  | 'workflow.write'
  | 'workflow.publish'
  | 'rubric.write'
  | 'rubric.publish'
  | 'asset.deactivate'
  | 'member.manage'
  | 'reviewer.manage'
  | 'workspace.manage'
  | 'audit.export'

export interface AuthUser {
  id: string
  email: string
  displayName: string
  isOrganizationAdmin: boolean
  lastWorkspaceId?: string | null
}

export interface AuthSession {
  user: AuthUser
}

export interface WorkspaceSummary {
  id: string
  organizationId?: string
  name: string
  slug: string
  status?: string
  createdBy?: string | null
  createdAt?: string
  updatedAt?: string
  role?: WorkspaceRole
  capabilities?: WorkspaceCapability[]
  isOrganizationAdmin?: boolean
}

export interface InvitationPreview {
  email: string
  workspaceName: string
  role: WorkspaceRole
  expiresAt: string
}

export interface ReviewerQualification {
  role: string
  isExpert: boolean
  isActive: boolean
}

export interface WorkspaceMember {
  userId: string
  invitationId: string | null
  email: string
  displayName: string
  role: WorkspaceRole
  userStatus: string
  membershipStatus: string
  reviewer: ReviewerQualification | null
  lastLoginAt: string | null
}

export interface InvitationLink {
  invitationId: string
  email: string
  role: WorkspaceRole
  expiresAt: string
  activationUrl: string | null
}

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
  status?: string
}

export type RubricVersion = AssetVersion<Rubric>

export interface EvaluationDimensionScore {
  name: string
  weight: number
  score: number
}

export interface EvaluationRecord {
  id: string
  rubricId: string
  rubricVersion: string
  rubricSnapshot: Rubric
  subjectType: string
  subjectId: string | null
  artifactText: string
  dimensionScores: EvaluationDimensionScore[]
  score: number
  status: string
  rationale: string
  createdAt: string
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

export interface Reviewer {
  id: string
  userId?: string | null
  name: string
  role: string
  isExpert: boolean
  isActive: boolean
}

export interface ReviewGroup {
  id: string
  name: string
  assignmentMode: 'group_claim' | 'round_robin'
  isEscalationGroup: boolean
  members: Reviewer[]
}

export type HumanTaskStatus =
  | '待认领'
  | '审核中'
  | '已通过'
  | '修改后通过'
  | '已驳回'
  | '已退回'
  | '恢复失败'

export type SlaStatus = '正常' | '即将到期' | '已逾期' | '已升级'

export interface HumanTask {
  id: string
  workflowRunId: string
  nodeRunId: string
  humanNodeId: string
  sourceNodeId: string
  artifactVersionId: string
  title: string
  status: HumanTaskStatus
  assignmentType: 'direct_reviewer' | 'group_claim' | 'round_robin'
  assigneeReviewerId: string | null
  assigneeGroupId: string | null
  reviewPolicy: 'any_one' | 'all' | 'threshold'
  requiredApprovals: number
  participantSnapshot: string[]
  dueAt: string
  escalationAt: string
  slaStatus: SlaStatus
  escalationGroupId: string | null
  createdAt: string
  updatedAt: string
}

export interface ArtifactVersionSummary {
  id: string
  version: number
  content: string
  createdBy: string
  createdAt: string
}

export interface AuditEvent {
  id: string
  eventType: string
  actorId: string
  reason: string
  beforeStatus: string
  afterStatus: string
  payload: Record<string, unknown>
  createdAt: string
}

export interface NotificationOutboxItem {
  id: string
  eventType: string
  recipientType: string
  recipientId: string
  payload: Record<string, unknown>
  status: string
  createdAt: string
}

export interface HumanTaskDetail extends HumanTask {
  artifact: ArtifactVersionSummary
  run: {
    id: string
    name: string
    status: string
    currentNode: string
    score: number | null
  }
  approvalProgress: {
    required: number
    received: number
  }
  auditEvents: AuditEvent[]
  notifications: NotificationOutboxItem[]
}

export type HumanTaskDecision =
  | 'approve'
  | 'reject'
  | 'modify_and_approve'
  | 'return_for_rerun'

export interface FeedbackCandidate {
  id: string
  humanTaskId: string
  originalVersionId: string
  modifiedVersionId: string
  originalContent: string
  modifiedContent: string
  unifiedDiff: string
  reason: string
  tags: string[]
  workflowRunId: string
  workflowId: string | null
  agentId: string | null
  sourceNodeId: string
  createdBy: string
  status: '待确认' | '已确认'
  createdAt: string
  confirmedAt: string | null
}

export interface GoldenSample {
  id: string
  candidateId: string
  input: string
  expectedOutput: string
  reviewerId: string
  reason: string
  createdAt: string
}

export interface RegressionSample {
  id: string
  sampleSetId: string
  name: string
  input: string
  expectedOutput: string
  tags: string[]
  sourceType: string
  sourceId: string | null
  status: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface RegressionSampleSet {
  id: string
  name: string
  description: string
  status: string
  sampleCount: number
  activeSampleCount: number
  samples: RegressionSample[]
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface RegressionRun {
  id: string
  sampleSetId: string | null
  sampleSetName: string
  rubricId: string
  rubricName: string
  rubricVersion: string
  status: string
  totalSamples: number
  passedSamples: number
  failedSamples: number
  passRate: number
  evaluationIds: string[]
  records: EvaluationRecord[]
  createdBy: string
  createdAt: string
  completedAt: string
}

export type RemediationTaskStatus = 'open' | 'in_progress' | 'done'

export interface RemediationTask {
  id: string
  sourceRunId: string
  clusterKey: string
  title: string
  priority: 'P0' | 'P1' | 'P2'
  sampleIds: string[]
  action: string
  status: RemediationTaskStatus
  retestRunId: string | null
  retestRun: RegressionRun | null
  createdBy: string
  updatedBy: string
  createdAt: string
  updatedAt: string
}

export interface EvaluationOverviewTotals {
  feedbackCandidates: number
  pendingCandidates: number
  confirmedCandidates: number
  goldenSamples: number
  coveredWorkflows: number
  coveredAgents: number
}

export interface EvaluationFeedbackCandidateSummary {
  id: string
  reason: string
  tags: string[]
  workflowId: string | null
  agentId: string | null
  sourceNodeId: string
  createdBy: string
  status: string
  createdAt: string
  confirmedAt: string | null
}

export interface EvaluationOverview {
  totals: EvaluationOverviewTotals
  recentCandidates: EvaluationFeedbackCandidateSummary[]
}

export interface ObservabilityTotals {
  totalRuns: number
  succeededRuns: number
  failedRuns: number
  waitingForHuman: number
  resumeFailed: number
  averageDurationMs: number
  totalPromptTokens: number
  totalCompletionTokens: number
  totalCostUsd: number
}

export interface ObservabilityRunSummary {
  id: string
  traceId: string
  workflowName: string
  status: string
  score: number | null
  currentNode: string
  startedAt: string
  completedAt: string | null
  durationMs: number | null
  costUsd: number
  promptTokens: number
  completionTokens: number
  priority: 'critical' | 'warning' | 'normal'
  nextAction: string
  failureCategory: string
  failureCategoryLabel: string
  troubleshootingHint: string
}

export interface ObservabilityRisk {
  runId: string
  title: string
  severity: 'critical' | 'warning'
  message: string
  nextAction: string
}

export interface ObservabilityAlert {
  id: string
  eventKey: string
  eventType: string
  severity: 'critical' | 'warning'
  channel: string
  status: string
  title: string
  message: string
  runId: string | null
  humanTaskId: string | null
  nextAction: string
  createdAt: string
}

export interface ObservabilityOverview {
  totals: ObservabilityTotals
  risks: ObservabilityRisk[]
  alerts: ObservabilityAlert[]
  recentRuns: ObservabilityRunSummary[]
}

export interface ObservabilityNodeRun {
  id: string
  traceId: string
  spanId: string
  parentSpanId: string | null
  nodeId: string
  nodeType: string
  nodeName: string
  status: string
  input: string
  output: string
  error: string
  score: number | null
  durationMs: number
  attempts: number
  model: string
  promptTokens: number
  completionTokens: number
  costUsd: number
  startedAt: string
  completedAt: string | null
}

export interface ObservabilityHumanTask {
  id: string
  title: string
  status: string
  slaStatus: string
  dueAt: string
  escalationAt: string
  assigneeReviewerId: string | null
  assigneeGroupId: string | null
}

export interface ObservabilityAuditEvent {
  id: string
  traceId: string
  spanId: string | null
  eventType: string | null
  actorId: string | null
  outcome: string | null
  reason: string
  createdAt: string
}

export interface ObservabilityRunDetail extends ObservabilityRunSummary {
  input: string
  output: string
  error: string
  model: string
  nodes: ObservabilityNodeRun[]
  humanTasks: ObservabilityHumanTask[]
  auditEvents: ObservabilityAuditEvent[]
}

export interface HumanSlaTotals {
  activeTasks: number
  unclaimed: number
  inReview: number
  dueSoon: number
  overdue: number
  escalated: number
  resumeFailed: number
}

export interface HumanSlaRisk {
  taskId: string
  runId: string
  title: string
  status: string
  slaStatus: string
  severity: 'critical' | 'warning'
  assigneeReviewerId: string | null
  assigneeGroupId: string | null
  dueAt: string
  escalationAt: string
  nextAction: string
}

export interface HumanSlaFilterOption {
  id: string
  name: string
}

export interface HumanSlaOverview {
  totals: HumanSlaTotals
  risks: HumanSlaRisk[]
  reviewers: HumanSlaFilterOption[]
  groups: HumanSlaFilterOption[]
}

export interface CostUsageTotals {
  runs: number
  totalPromptTokens: number
  totalCompletionTokens: number
  totalTokens: number
  totalCostUsd: number
}

export interface CostUsageGroup {
  name: string
  runs: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: number
  averageScore: number | null
}

export interface CostUsageOverview {
  costConfigured: boolean
  totals: CostUsageTotals
  byWorkflow: CostUsageGroup[]
  byModel: CostUsageGroup[]
}
