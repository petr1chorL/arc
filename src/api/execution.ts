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

export async function runAgent(agentId: string, input: RunInput): Promise<ExecutionRun> {
  return readJson<ExecutionRun>(await apiFetch(`/api/agents/${agentId}/test-runs`, {
    ...jsonRequest,
    body: JSON.stringify(input),
  }))
}

export async function runWorkflow(workflowId: string, input: RunInput): Promise<ExecutionRun> {
  return readJson<ExecutionRun>(await apiFetch(`/api/workflows/${workflowId}/runs`, {
    ...jsonRequest,
    body: JSON.stringify(input),
  }))
}

export async function listRuns(): Promise<ExecutionRun[]> {
  return readJson<ExecutionRun[]>(await apiFetch('/api/runs'))
}

export async function getRun(runId: string): Promise<ExecutionRun> {
  return readJson<ExecutionRun>(await apiFetch(`/api/runs/${runId}`))
}

export async function listReviews(): Promise<HumanReview[]> {
  return readJson<HumanReview[]>(await apiFetch('/api/reviews'))
}

export async function decideReview(
  reviewId: string,
  decision: ReviewDecision,
): Promise<HumanReview> {
  return readJson<HumanReview>(await apiFetch(`/api/reviews/${reviewId}/decision`, {
    ...jsonRequest,
    body: JSON.stringify({ decision }),
  }))
}
