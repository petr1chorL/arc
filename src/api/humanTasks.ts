import type {
  FeedbackCandidate,
  GoldenSample,
  HumanTask,
  HumanTaskDecision,
  HumanTaskDetail,
  Reviewer,
  ReviewGroup,
} from '../types'
import { apiFetch, readJson } from './http'

const jsonRequest = {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
} as const

function workspacePath(workspaceId: string, path: string) {
  return `/api/workspaces/${workspaceId}${path}`
}

export async function listReviewers(workspaceId: string): Promise<Reviewer[]> {
  return readJson<Reviewer[]>(await apiFetch(workspacePath(workspaceId, '/reviewers')))
}

export async function listReviewGroups(workspaceId: string): Promise<ReviewGroup[]> {
  return readJson<ReviewGroup[]>(await apiFetch(workspacePath(workspaceId, '/review-groups')))
}

export async function listHumanTasks(workspaceId: string): Promise<HumanTask[]> {
  return readJson<HumanTask[]>(await apiFetch(workspacePath(workspaceId, '/human-tasks')))
}

export async function getHumanTask(workspaceId: string, taskId: string): Promise<HumanTaskDetail> {
  return readJson<HumanTaskDetail>(await apiFetch(workspacePath(workspaceId, `/human-tasks/${taskId}`)))
}

export async function claimHumanTask(
  workspaceId: string,
  taskId: string,
): Promise<HumanTask> {
  return readJson<HumanTask>(await apiFetch(workspacePath(workspaceId, `/human-tasks/${taskId}/claim`), {
    method: 'POST',
  }))
}

export async function transferHumanTask(
  workspaceId: string,
  taskId: string,
  input: {
    reviewerId?: string
    groupId?: string
    reason: string
  },
): Promise<HumanTask> {
  return readJson<HumanTask>(await apiFetch(workspacePath(workspaceId, `/human-tasks/${taskId}/transfer`), {
    ...jsonRequest,
    body: JSON.stringify(input),
  }))
}

export async function decideHumanTask(
  workspaceId: string,
  taskId: string,
  input: {
    decision: HumanTaskDecision
    reason: string
    artifactVersionId: string
    idempotencyKey: string
    modifiedContent?: string
    tags?: string[]
  },
): Promise<HumanTaskDetail> {
  return readJson<HumanTaskDetail>(await apiFetch(workspacePath(workspaceId, `/human-tasks/${taskId}/decisions`), {
    ...jsonRequest,
    body: JSON.stringify(input),
  }))
}

export async function retryHumanTaskResume(workspaceId: string, taskId: string): Promise<HumanTaskDetail> {
  return readJson<HumanTaskDetail>(await apiFetch(workspacePath(workspaceId, `/human-tasks/${taskId}/retry-resume`), {
    ...jsonRequest,
  }))
}

export async function listFeedbackCandidates(workspaceId: string): Promise<FeedbackCandidate[]> {
  return readJson<FeedbackCandidate[]>(await apiFetch(workspacePath(workspaceId, '/feedback-candidates')))
}

export async function confirmFeedbackCandidate(
  workspaceId: string,
  candidateId: string,
  input: {
    reason: string
    idempotencyKey: string
  },
): Promise<GoldenSample> {
  return readJson<GoldenSample>(await apiFetch(workspacePath(workspaceId, `/feedback-candidates/${candidateId}/confirm`), {
    ...jsonRequest,
    body: JSON.stringify(input),
  }))
}
