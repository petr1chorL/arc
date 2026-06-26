import type { ExecutionRun, HumanReview } from '../types'
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
