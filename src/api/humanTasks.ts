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

export async function listReviewers(): Promise<Reviewer[]> {
  return readJson<Reviewer[]>(await apiFetch('/api/reviewers'))
}

export async function listReviewGroups(): Promise<ReviewGroup[]> {
  return readJson<ReviewGroup[]>(await apiFetch('/api/review-groups'))
}

export async function listHumanTasks(): Promise<HumanTask[]> {
  return readJson<HumanTask[]>(await apiFetch('/api/human-tasks'))
}

export async function getHumanTask(taskId: string): Promise<HumanTaskDetail> {
  return readJson<HumanTaskDetail>(await apiFetch(`/api/human-tasks/${taskId}`))
}

export async function claimHumanTask(
  taskId: string,
  reviewerId: string,
): Promise<HumanTask> {
  return readJson<HumanTask>(await apiFetch(`/api/human-tasks/${taskId}/claim`, {
    ...jsonRequest,
    body: JSON.stringify({ reviewerId }),
  }))
}

export async function transferHumanTask(
  taskId: string,
  input: {
    actorId: string
    reviewerId?: string
    groupId?: string
    reason: string
  },
): Promise<HumanTask> {
  return readJson<HumanTask>(await apiFetch(`/api/human-tasks/${taskId}/transfer`, {
    ...jsonRequest,
    body: JSON.stringify(input),
  }))
}

export async function decideHumanTask(
  taskId: string,
  input: {
    reviewerId: string
    decision: HumanTaskDecision
    reason: string
    artifactVersionId: string
    idempotencyKey: string
    modifiedContent?: string
    tags?: string[]
  },
): Promise<HumanTaskDetail> {
  return readJson<HumanTaskDetail>(await apiFetch(`/api/human-tasks/${taskId}/decisions`, {
    ...jsonRequest,
    body: JSON.stringify(input),
  }))
}

export async function retryHumanTaskResume(taskId: string): Promise<HumanTaskDetail> {
  return readJson<HumanTaskDetail>(await apiFetch(`/api/human-tasks/${taskId}/retry-resume`, {
    ...jsonRequest,
  }))
}

export async function listFeedbackCandidates(): Promise<FeedbackCandidate[]> {
  return readJson<FeedbackCandidate[]>(await apiFetch('/api/feedback-candidates'))
}

export async function confirmFeedbackCandidate(
  candidateId: string,
  input: {
    reviewerId: string
    reason: string
    idempotencyKey: string
  },
): Promise<GoldenSample> {
  return readJson<GoldenSample>(await apiFetch(`/api/feedback-candidates/${candidateId}/confirm`, {
    ...jsonRequest,
    body: JSON.stringify(input),
  }))
}
