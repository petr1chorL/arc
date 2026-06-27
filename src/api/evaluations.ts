import type {
  EvaluationRecord,
  EvaluationOverview,
  RegressionSample,
  RegressionSampleSet,
  Rubric,
  RubricVersion,
} from '../types'
import { apiFetch, readJson } from './http'

export interface RubricInput {
  name: string
  artifact: string
  dimensions: { name: string; weight: number }[]
  gate: string
  passScore: number
}

export interface RubricEvaluationInput {
  artifactText: string
  subjectType: string
  subjectId?: string | null
}

export interface RegressionSampleSetInput {
  name: string
  description: string
}

export interface RegressionSampleInput {
  name: string
  input: string
  expectedOutput: string
  tags: string[]
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

export async function listRegressionSampleSets(workspaceId: string): Promise<RegressionSampleSet[]> {
  return readJson<RegressionSampleSet[]>(
    await apiFetch(workspacePath(workspaceId, '/sample-sets')),
  )
}

export async function createRegressionSampleSet(
  workspaceId: string,
  input: RegressionSampleSetInput,
): Promise<RegressionSampleSet> {
  return readJson<RegressionSampleSet>(
    await apiFetch(workspacePath(workspaceId, '/sample-sets'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  )
}

export async function createRegressionSample(
  workspaceId: string,
  sampleSetId: string,
  input: RegressionSampleInput,
): Promise<RegressionSample> {
  return readJson<RegressionSample>(
    await apiFetch(workspacePath(workspaceId, `/sample-sets/${sampleSetId}/samples`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  )
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

export async function evaluateRubric(
  workspaceId: string,
  rubricId: string,
  input: RubricEvaluationInput,
): Promise<EvaluationRecord> {
  return readJson<EvaluationRecord>(
    await apiFetch(workspacePath(workspaceId, `/rubrics/${rubricId}/evaluate`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  )
}

export async function listEvaluationRecords(workspaceId: string): Promise<EvaluationRecord[]> {
  return readJson<EvaluationRecord[]>(
    await apiFetch(workspacePath(workspaceId, '/records')),
  )
}
