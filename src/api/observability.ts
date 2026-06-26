import type { ObservabilityOverview, ObservabilityRunDetail } from '../types'
import { apiFetch, readJson } from './http'

function workspacePath(workspaceId: string, path = '') {
  return `/api/workspaces/${workspaceId}/observability${path}`
}

export async function getObservabilityOverview(workspaceId: string): Promise<ObservabilityOverview> {
  return readJson<ObservabilityOverview>(await apiFetch(workspacePath(workspaceId, '/overview')))
}

export async function getObservabilityRunDetail(
  workspaceId: string,
  runId: string,
): Promise<ObservabilityRunDetail> {
  return readJson<ObservabilityRunDetail>(await apiFetch(workspacePath(workspaceId, `/runs/${runId}`)))
}
