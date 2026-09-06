import { ApiError } from '../identity-workspace/handler.ts'
import { createTransactionBackend, workspaceContext, requireCapability, type SqlClient, type SqlPool } from '../identity-workspace/postgres.ts'
import type { FeedbackInput } from './handler.ts'
import { parseGoldenSampleConfirm } from './policy.ts'
import { randomUUID } from 'node:crypto'

type CandidateRow = {
  id: string; workspace_id: string; human_task_id: string; original_version_id: string; modified_version_id: string
  diff_id: string; reason: string; tags: string[]; workflow_run_id: string; workflow_id: string | null
  agent_id: string | null; source_node_id: string; created_by: string; status: string
  created_at: Date | string; confirmed_at: Date | string | null
}

/** Candidate governance shares the authenticated transaction boundary; no production route is registered. */
export function createPostgresFeedbackBackend(pool: SqlPool) {
  return createTransactionBackend<FeedbackInput>(pool, async (client, input) => {
    const confirm = input.route.operation === 'confirm'
    const context = await workspaceContext(client, input, confirm, confirm)
    if (input.route.operation === 'confirm') {
      const data = parseGoldenSampleConfirm(input.body)
      const reviewer = await activeReviewer(client, context.workspace.id, context.user.id)
      return { status: 201, body: await confirmCandidate(client, context.workspace.id, context.user.id,
        input.route.params.candidateId!, reviewer, data) }
    }
    const list = input.route.operation === 'list'
    await requireCapability(client, context, input, 'asset.read', {
      action: list ? 'feedback_candidate.list' : 'feedback_candidate.read',
      targetType: list ? 'workspace' : 'feedback_candidate',
      targetId: list ? context.workspace.id : input.route.params.candidateId!,
    })
    return { body: await readFeedbackCandidates(client, context.workspace.id, list ? undefined : input.route.params.candidateId!) }
  })
}

async function activeReviewer(client: SqlClient, workspaceId: string, userId: string) {
  // Match Python qualification reads: User -> Membership -> Reviewer; hold through commit.
  const user = (await client.query<{ status: string }>('SELECT status FROM users WHERE id=$1 FOR SHARE', [userId])).rows[0]
  const member = (await client.query('SELECT id FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$2 AND status=$3 FOR SHARE',
    [workspaceId, userId, 'active'])).rows[0]
  const reviewer = (await client.query<{ id: string; is_expert: boolean }>(
    'SELECT id,is_expert FROM reviewers WHERE workspace_id=$1 AND user_id=$2 AND is_active=true FOR SHARE', [workspaceId, userId])).rows[0]
  if (user?.status !== 'active' || !member || !reviewer) throw new ApiError(403, '当前用户没有有效审核资格')
  return reviewer
}

type SampleRow = { id: string; workspace_id: string; candidate_id: string; input_text: string; expected_output: string
  reviewer_id: string; reason: string; created_at: Date | string }
const samplePayload = (row: SampleRow) => ({ id: row.id, candidateId: row.candidate_id, input: row.input_text,
  expectedOutput: row.expected_output, reviewerId: row.reviewer_id, reason: row.reason, createdAt: new Date(row.created_at).toISOString() })

async function confirmCandidate(client: SqlClient, workspaceId: string, userId: string, candidateId: string,
  reviewer: { id: string; is_expert: boolean }, data: { reason: string; idempotency_key: string }) {
  const candidate = (await client.query<CandidateRow>('SELECT * FROM feedback_candidates WHERE workspace_id=$1 AND id=$2 FOR UPDATE',
    [workspaceId, candidateId])).rows[0]
  if (!candidate) throw new ApiError(422, '反馈候选不存在')
  if (!reviewer.is_expert) throw new ApiError(403, '只有专家审核人可以确认黄金样本')
  const replay = (await client.query<SampleRow>('SELECT * FROM golden_samples WHERE idempotency_key=$1', [data.idempotency_key])).rows[0]
  if (replay) {
    if (replay.workspace_id !== workspaceId || replay.candidate_id !== candidate.id || replay.reviewer_id !== reviewer.id) {
      throw new ApiError(409, '幂等键已用于其他黄金样本')
    }
    return samplePayload(replay)
  }
  if ((await client.query('SELECT id FROM golden_samples WHERE candidate_id=$1', [candidate.id])).rows.length) {
    throw new ApiError(409, '反馈候选已确认黄金样本')
  }
  const modified = (await client.query<{ content: string }>(
    'SELECT content FROM artifact_versions WHERE workspace_id=$1 AND id=$2 FOR SHARE', [workspaceId, candidate.modified_version_id])).rows[0]
  const run = (await client.query<{ input_text: string }>(
    'SELECT input_text FROM workflow_runs WHERE workspace_id=$1 AND id=$2 FOR SHARE', [workspaceId, candidate.workflow_run_id])).rows[0]
  const task = (await client.query<{ id: string; status: string }>(
    'SELECT id,status FROM human_tasks WHERE workspace_id=$1 AND id=$2 FOR SHARE', [workspaceId, candidate.human_task_id])).rows[0]
  if (!modified || !run || !task) throw new ApiError(422, '黄金样本来源不完整，需先完成治理')
  const sample: SampleRow = { id: randomUUID(), workspace_id: workspaceId, candidate_id: candidate.id, input_text: run.input_text,
    expected_output: modified.content, reviewer_id: reviewer.id, reason: data.reason, created_at: new Date() }
  try {
    await client.query(`INSERT INTO golden_samples (id,workspace_id,candidate_id,input_text,expected_output,reviewer_id,reason,idempotency_key,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [sample.id, workspaceId, candidate.id, sample.input_text, sample.expected_output,
      reviewer.id, data.reason, data.idempotency_key, sample.created_at])
  } catch (error) {
    const failure = error as { code?: string; constraint?: string }
    if (failure.code === '23505' && ['uq_golden_sample_candidate', 'uq_golden_sample_idempotency'].includes(failure.constraint ?? '')) {
      throw new ApiError(409, '黄金样本确认冲突，请刷新后重试')
    }
    throw error
  }
  await client.query('UPDATE feedback_candidates SET status=$1,confirmed_at=$2 WHERE workspace_id=$3 AND id=$4',
    ['已确认', new Date(), workspaceId, candidate.id])
  await client.query(`INSERT INTO audit_events
    (id,workspace_id,human_task_id,actor_user_id,action,target_type,target_id,outcome,event_type,actor_id,reason,before_status,after_status,payload,metadata,trace_id,created_at)
    VALUES ($1,$2,$3,$4,'golden_sample_confirmed','human_task',$3,'success','golden_sample_confirmed',$5,$6,'',$7,$8,'{}','',$9)`,
  [randomUUID(), workspaceId, task.id, userId, reviewer.id, data.reason, task.status,
    JSON.stringify({ candidateId: candidate.id, goldenSampleId: sample.id }), new Date()])
  return samplePayload(sample)
}

/** Read a scoped candidate and its immutable source text without repairing source records. */
export async function readFeedbackCandidates(client: SqlClient, workspaceId: string, candidateId?: string) {
  const result = await client.query<CandidateRow>(
    `SELECT * FROM feedback_candidates WHERE workspace_id=$1${candidateId === undefined ? ' ORDER BY created_at DESC' : ' AND id=$2'}`,
    candidateId === undefined ? [workspaceId] : [workspaceId, candidateId])
  if (candidateId !== undefined && !result.rows.length) throw new ApiError(404, '反馈候选不存在')
  const payloads = []
  for (const row of result.rows) payloads.push(await candidatePayload(client, row))
  return candidateId === undefined ? payloads : payloads[0]
}

async function candidatePayload(client: SqlClient, row: CandidateRow) {
  const original = (await client.query<{ content: string }>(
    'SELECT content FROM artifact_versions WHERE workspace_id=$1 AND id=$2', [row.workspace_id, row.original_version_id])).rows[0]
  const modified = (await client.query<{ content: string }>(
    'SELECT content FROM artifact_versions WHERE workspace_id=$1 AND id=$2', [row.workspace_id, row.modified_version_id])).rows[0]
  const diff = (await client.query<{ unified_diff: string }>(
    'SELECT unified_diff FROM artifact_diffs WHERE workspace_id=$1 AND id=$2', [row.workspace_id, row.diff_id])).rows[0]
  if (!original || !modified || !diff) throw new ApiError(409, '反馈候选来源不完整，需先完成治理')
  return {
    id: row.id, humanTaskId: row.human_task_id, originalVersionId: row.original_version_id, modifiedVersionId: row.modified_version_id,
    originalContent: original.content, modifiedContent: modified.content, unifiedDiff: diff.unified_diff,
    reason: row.reason, tags: row.tags, workflowRunId: row.workflow_run_id, workflowId: row.workflow_id,
    agentId: row.agent_id, sourceNodeId: row.source_node_id, createdBy: row.created_by, status: row.status,
    createdAt: new Date(row.created_at).toISOString(), confirmedAt: row.confirmed_at === null ? null : new Date(row.confirmed_at).toISOString(),
  }
}
