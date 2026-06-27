import type { ModelProvider, ModelProviderConnectivity, ModelProviderType } from '../types'
import { apiFetch, readJson } from './http'

export interface CreateModelProviderInput {
  name: string
  providerType: ModelProviderType
  baseUrl: string
  defaultModel: string
  secretRef: string
}

function workspacePath(workspaceId: string, path = '') {
  return `/api/workspaces/${workspaceId}/model-providers${path}`
}

export async function listModelProviders(workspaceId: string): Promise<ModelProvider[]> {
  return readJson<ModelProvider[]>(await apiFetch(workspacePath(workspaceId)))
}

export async function createModelProvider(
  workspaceId: string,
  input: CreateModelProviderInput,
): Promise<ModelProvider> {
  return readJson<ModelProvider>(await apiFetch(workspacePath(workspaceId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }))
}

export async function testModelProviderConnection(
  workspaceId: string,
  providerId: string,
): Promise<ModelProviderConnectivity> {
  return readJson<ModelProviderConnectivity>(await apiFetch(workspacePath(workspaceId, `/${providerId}/test`), {
    method: 'POST',
  }))
}
