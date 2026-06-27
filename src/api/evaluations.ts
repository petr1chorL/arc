import type { EvaluationOverview, Rubric, RubricVersion } from '../types'
import { apiFetch, readJson } from './http'

export interface RubricInput {
  name: string
  artifact: string
  dimensions: { name: string; weight: number }[]
  gate: string
  passScore: number
}

function workspacePath(workspaceId: string, path = '') {
  return `/api/workspaces/${workspaceId}/evaluations${path}`
}

export async function getEvaluationOverview(workspaceId: string): Promise<EvaluationOverview> {
  return readJson<EvaluationOverview>(await apiFetch(workspacePath(workspaceId, '/overview')))
}

export async function getRubrics(workspaceId: string): Promise<Rubric[]> {
  return readJson<Rubric[]>(await apiFetch(workspacePath(workspaceId, '/rubrics')))
}

export async function createRubric(workspaceId: string, input: RubricInput): Promise<Rubric> {
  return readJson<Rubric>(await apiFetch(workspacePath(workspaceId, '/rubrics'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }))
}

export async function updateRubric(
  workspaceId: string,
  rubricId: string,
  input: RubricInput,
): Promise<Rubric> {
  return readJson<Rubric>(await apiFetch(workspacePath(workspaceId, `/rubrics/${rubricId}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }))
}

export async function listRubricVersions(workspaceId: string, rubricId: string): Promise<RubricVersion[]> {
  return readJson<RubricVersion[]>(
    await apiFetch(workspacePath(workspaceId, `/rubrics/${rubricId}/versions`)),
  )
}

export async function publishRubric(workspaceId: string, rubricId: string): Promise<RubricVersion> {
  return readJson<RubricVersion>(
    await apiFetch(workspacePath(workspaceId, `/rubrics/${rubricId}/publish`), {
      method: 'POST',
    }),
  )
}

export async function deactivateRubric(workspaceId: string, rubricId: string): Promise<Rubric> {
  return readJson<Rubric>(
    await apiFetch(workspacePath(workspaceId, `/rubrics/${rubricId}/deactivate`), {
      method: 'POST',
    }),
  )
}
