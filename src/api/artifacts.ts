import type { ArtifactCatalogItem } from '../types'
import { apiFetch, readJson } from './http'

function workspacePath(workspaceId: string, path = '') {
  return `/api/workspaces/${workspaceId}/artifacts${path}`
}

export interface ArtifactListFilters {
  dataObjectDefinitionId?: string
  schemaValidationStatus?: 'passed' | 'failed' | 'unchecked' | ''
  runId?: string
  sourceNodeRunId?: string
}

export async function listArtifacts(
  workspaceId: string,
  filters: ArtifactListFilters = {},
): Promise<ArtifactCatalogItem[]> {
  const params = new URLSearchParams()
  const definitionId = filters.dataObjectDefinitionId?.trim()
  if (definitionId) {
    params.set('dataObjectDefinitionId', definitionId)
  }
  if (filters.schemaValidationStatus) {
    params.set('schemaValidationStatus', filters.schemaValidationStatus)
  }
  const runId = filters.runId?.trim()
  if (runId) {
    params.set('runId', runId)
  }
  const sourceNodeRunId = filters.sourceNodeRunId?.trim()
  if (sourceNodeRunId) {
    params.set('sourceNodeRunId', sourceNodeRunId)
  }
  const query = params.toString()
  return readJson<ArtifactCatalogItem[]>(
    await apiFetch(workspacePath(workspaceId, query ? `?${query}` : '')),
  )
}
