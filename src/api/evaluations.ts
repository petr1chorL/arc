import type { EvaluationOverview, Rubric } from '../types'
import { apiFetch, readJson } from './http'

function workspacePath(workspaceId: string, path = '') {
  return `/api/workspaces/${workspaceId}/evaluations${path}`
}

export async function getEvaluationOverview(workspaceId: string): Promise<EvaluationOverview> {
  return readJson<EvaluationOverview>(await apiFetch(workspacePath(workspaceId, '/overview')))
}

export async function getRubrics(workspaceId: string): Promise<Rubric[]> {
  return readJson<Rubric[]>(await apiFetch(workspacePath(workspaceId, '/rubrics')))
}
