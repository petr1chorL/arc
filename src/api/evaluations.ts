import type {
  EvaluationRecord,
  EvaluationOverview,
  RemediationTaskActivity,
  RemediationTask,
  RegressionRun,
  RegressionSample,
  RegressionSampleSet,
  Rubric,
  RubricVersion,
} from '../types'
import { apiFetch, readJson } from './http'

export interface RubricDimensionInput {
  id: string
  name: string
  weight: number
  criteria: string
}

export interface RubricInput {
  name: string
  artifact: string
  dimensions: RubricDimensionInput[]
  gate: string
  passScore: number
  judgeType?: 'deterministic' | 'llm'
  judgeModel?: string
  modelProviderId?: string | null
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

export interface RegressionRunInput {
  rubricId: string
  sampleSetId?: string | null
  samples?: { input: string; sampleId?: string | null }[]
}

export interface RemediationTaskInput {
  sourceRunId: string
  clusterKey: string
  title: string
  priority: RemediationTask['priority']
  sampleIds: string[]
  action: string
  owner?: string
  dueDate?: string
}

export interface RemediationTaskFilters {
  owner?: string
  priority?: RemediationTask['priority']
  overdue?: boolean
}

export interface RemediationTaskActivityInput {
  body: string
  attachmentRefs: string[]
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

export async function listRegressionRuns(workspaceId: string): Promise<RegressionRun[]> {
  return readJson<RegressionRun[]>(
    await apiFetch(workspacePath(workspaceId, '/regression-runs')),
  )
}

export async function getRegressionRun(
  workspaceId: string,
  runId: string,
): Promise<RegressionRun> {
  return readJson<RegressionRun>(
    await apiFetch(workspacePath(workspaceId, `/regression-runs/${runId}`)),
  )
}

export async function createRegressionRun(
  workspaceId: string,
  input: RegressionRunInput,
): Promise<RegressionRun> {
  return readJson<RegressionRun>(
    await apiFetch(workspacePath(workspaceId, '/regression-runs'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  )
}

function withQuery(path: string, query: Record<string, string | boolean | undefined>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    params.set(key, String(value))
  }
  const search = params.toString()
  return search ? `${path}?${search}` : path
}

export async function listRemediationTasks(
  workspaceId: string,
  filters: RemediationTaskFilters = {},
): Promise<RemediationTask[]> {
  return readJson<RemediationTask[]>(
    await apiFetch(workspacePath(workspaceId, withQuery('/remediation-tasks', {
      owner: filters.owner,
      priority: filters.priority,
      overdue: filters.overdue,
    }))),
  )
}

export async function getRemediationTask(
  workspaceId: string,
  taskId: string,
): Promise<RemediationTask> {
  return readJson<RemediationTask>(
    await apiFetch(workspacePath(workspaceId, `/remediation-tasks/${taskId}`)),
  )
}

export async function createRemediationTask(
  workspaceId: string,
  input: RemediationTaskInput,
): Promise<RemediationTask> {
  return readJson<RemediationTask>(
    await apiFetch(workspacePath(workspaceId, '/remediation-tasks'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  )
}

export interface RemediationTaskUpdateInput {
  status?: RemediationTask['status']
  owner?: string | null
  priority?: RemediationTask['priority']
  dueDate?: string | null
}

export async function updateRemediationTask(
  workspaceId: string,
  taskId: string,
  input: RemediationTaskUpdateInput,
): Promise<RemediationTask> {
  return readJson<RemediationTask>(
    await apiFetch(workspacePath(workspaceId, `/remediation-tasks/${taskId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  )
}

export async function createRemediationTaskActivity(
  workspaceId: string,
  taskId: string,
  input: RemediationTaskActivityInput,
): Promise<RemediationTaskActivity> {
  return readJson<RemediationTaskActivity>(
    await apiFetch(workspacePath(workspaceId, `/remediation-tasks/${taskId}/activities`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  )
}

export async function retestRemediationTask(
  workspaceId: string,
  taskId: string,
): Promise<RemediationTask> {
  return readJson<RemediationTask>(
    await apiFetch(workspacePath(workspaceId, `/remediation-tasks/${taskId}/retest`), {
      method: 'POST',
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
