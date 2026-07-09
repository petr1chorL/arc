import type { ExecutionJob, ExecutionJobDetail, ExecutionRun, HumanReview, RunOperationHistoryEvent } from '../types'
import { apiFetch, readJson } from './http'

export interface RunInput {
  input: string
  version?: string
}

export interface BatchRerunResult {
  createdRuns: ExecutionRun[]
  failures: Array<{
    sourceRunId: string
    reason: string
  }>
}

export interface BatchResumeResult {
  resumedRuns: ExecutionRun[]
  failures: Array<{
    sourceRunId: string
    reason: string
  }>
}

export type ReviewDecision = 'approve' | 'reject'

const jsonRequest = {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
} as const

function workspacePath(workspaceId: string, path: string) {
  return `/api/workspaces/${workspaceId}${path}`
}

export async function runAgent(workspaceId: string, agentId: string, input: RunInput): Promise<ExecutionRun> {
  return readJson<ExecutionRun>(await apiFetch(workspacePath(workspaceId, `/agents/${agentId}/test-runs`), {
    ...jsonRequest,
    body: JSON.stringify(input),
  }))
}

export async function runWorkflow(workspaceId: string, workflowId: string, input: RunInput): Promise<ExecutionRun> {
  return readJson<ExecutionRun>(await apiFetch(workspacePath(workspaceId, `/workflows/${workflowId}/runs`), {
    ...jsonRequest,
    body: JSON.stringify(input),
  }))
}

export async function listRuns(workspaceId: string): Promise<ExecutionRun[]> {
  return readJson<ExecutionRun[]>(await apiFetch(workspacePath(workspaceId, '/runs')))
}

export async function deleteRun(workspaceId: string, runId: string): Promise<void> {
  await apiFetch(workspacePath(workspaceId, `/runs/${runId}`), { method: 'DELETE' })
}

export async function rerunWorkflowRun(
  workspaceId: string,
  runId: string,
  input?: Pick<RunInput, 'input'>,
): Promise<ExecutionRun> {
  return readJson<ExecutionRun>(await apiFetch(workspacePath(workspaceId, `/runs/${runId}/rerun`), {
    ...jsonRequest,
    ...(input ? { body: JSON.stringify(input) } : {}),
  }))
}

export async function batchRerunWorkflowRuns(workspaceId: string, runIds: string[]): Promise<BatchRerunResult> {
  return readJson<BatchRerunResult>(await apiFetch(workspacePath(workspaceId, '/runs/batch-rerun'), {
    ...jsonRequest,
    body: JSON.stringify({ runIds }),
  }))
}

export async function batchResumeRunsFromFailedNode(workspaceId: string, runIds: string[]): Promise<BatchResumeResult> {
  return readJson<BatchResumeResult>(
    await apiFetch(workspacePath(workspaceId, '/runs/batch-resume-from-failed-node'), {
      ...jsonRequest,
      body: JSON.stringify({ runIds }),
    }),
  )
}

export async function resumeRunFromFailedNode(workspaceId: string, runId: string): Promise<ExecutionRun> {
  return readJson<ExecutionRun>(await apiFetch(workspacePath(workspaceId, `/runs/${runId}/resume-from-failed-node`), {
    ...jsonRequest,
  }))
}

export async function listRunOperationHistory(
  workspaceId: string,
  runId: string,
): Promise<RunOperationHistoryEvent[]> {
  return readJson<RunOperationHistoryEvent[]>(
    await apiFetch(workspacePath(workspaceId, `/runs/${runId}/operation-history`)),
  )
}

export async function listExecutionJobs(workspaceId: string, status?: string): Promise<ExecutionJob[]> {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  const query = params.toString()
  return readJson<ExecutionJob[]>(
    await apiFetch(workspacePath(workspaceId, `/execution-jobs${query ? `?${query}` : ''}`)),
  )
}

export async function getExecutionJob(workspaceId: string, jobId: string): Promise<ExecutionJobDetail> {
  return readJson<ExecutionJobDetail>(
    await apiFetch(workspacePath(workspaceId, `/execution-jobs/${jobId}`)),
  )
}

export async function requeueExecutionJob(workspaceId: string, jobId: string, reason = ''): Promise<ExecutionJob> {
  return readJson<ExecutionJob>(await apiFetch(workspacePath(workspaceId, `/execution-jobs/${jobId}/requeue`), {
    ...jsonRequest,
    body: JSON.stringify({ reason }),
  }))
}

export async function cancelExecutionJob(workspaceId: string, jobId: string, reason = ''): Promise<ExecutionJob> {
  return readJson<ExecutionJob>(await apiFetch(workspacePath(workspaceId, `/execution-jobs/${jobId}/cancel`), {
    ...jsonRequest,
    body: JSON.stringify({ reason }),
  }))
}

export async function getRun(workspaceId: string, runId: string): Promise<ExecutionRun> {
  return readJson<ExecutionRun>(await apiFetch(workspacePath(workspaceId, `/runs/${runId}`)))
}

export async function listReviews(workspaceId: string): Promise<HumanReview[]> {
  return readJson<HumanReview[]>(await apiFetch(workspacePath(workspaceId, '/reviews')))
}

export async function decideReview(
  workspaceId: string,
  reviewId: string,
  decision: ReviewDecision,
): Promise<HumanReview> {
  return readJson<HumanReview>(await apiFetch(workspacePath(workspaceId, `/reviews/${reviewId}/decision`), {
    ...jsonRequest,
    body: JSON.stringify({ decision }),
  }))
}
