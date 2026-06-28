import type { ArtifactCatalogItem } from '../types'
import { apiFetch, readJson } from './http'

function workspacePath(workspaceId: string, path = '') {
  return `/api/workspaces/${workspaceId}/artifacts${path}`
}

export interface ArtifactListFilters {
  dataObjectDefinitionId?: string
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
  const query = params.toString()
  return readJson<ArtifactCatalogItem[]>(
    await apiFetch(workspacePath(workspaceId, query ? `?${query}` : '')),
  )
}
