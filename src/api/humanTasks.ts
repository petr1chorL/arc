import type { Reviewer, ReviewGroup } from '../types'
import { readJson } from './http'

export async function listReviewers(): Promise<Reviewer[]> {
  return readJson<Reviewer[]>(await fetch('/api/reviewers'))
}

export async function listReviewGroups(): Promise<ReviewGroup[]> {
  return readJson<ReviewGroup[]>(await fetch('/api/review-groups'))
}
