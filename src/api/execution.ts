import type { ExecutionJob, ExecutionRun, HumanReview } from '../types'
import { apiFetch, readJson } from './http'

export interface RunInput {
  input: string
  version?: string
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

export async function listExecutionJobs(workspaceId: string, status?: string): Promise<ExecutionJob[]> {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  const query = params.toString()
  return readJson<ExecutionJob[]>(
    await apiFetch(workspacePath(workspaceId, `/execution-jobs${query ? `?${query}` : ''}`)),
  )
}

export async function requeueExecutionJob(workspaceId: string, jobId: string): Promise<ExecutionJob> {
  return readJson<ExecutionJob>(await apiFetch(workspacePath(workspaceId, `/execution-jobs/${jobId}/requeue`), {
    method: 'POST',
  }))
}

export async function cancelExecutionJob(workspaceId: string, jobId: string): Promise<ExecutionJob> {
  return readJson<ExecutionJob>(await apiFetch(workspacePath(workspaceId, `/execution-jobs/${jobId}/cancel`), {
    method: 'POST',
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
