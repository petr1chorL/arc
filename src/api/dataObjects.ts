import type {
  DataObjectDefinition,
  DataObjectDefinitionCreateInput,
  DataObjectDefinitionUpdateInput,
  DataObjectVersion,
} from '../types'
import { apiFetch, readJson } from './http'

function workspacePath(workspaceId: string, path = '') {
  return `/api/workspaces/${workspaceId}/data-objects${path}`
}

export async function listDataObjectDefinitions(workspaceId: string): Promise<DataObjectDefinition[]> {
  return readJson<DataObjectDefinition[]>(await apiFetch(workspacePath(workspaceId)))
}

export async function createDataObjectDefinition(
  workspaceId: string,
  input: DataObjectDefinitionCreateInput,
): Promise<DataObjectDefinition> {
  return readJson<DataObjectDefinition>(await apiFetch(workspacePath(workspaceId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }))
}

export async function updateDataObjectDefinition(
  workspaceId: string,
  definitionId: string,
  input: DataObjectDefinitionUpdateInput,
): Promise<DataObjectDefinition> {
  return readJson<DataObjectDefinition>(await apiFetch(workspacePath(workspaceId, `/${definitionId}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }))
}

export async function publishDataObjectDefinition(
  workspaceId: string,
  definitionId: string,
): Promise<DataObjectVersion> {
  return readJson<DataObjectVersion>(await apiFetch(workspacePath(workspaceId, `/${definitionId}/publish`), {
    method: 'POST',
  }))
}
