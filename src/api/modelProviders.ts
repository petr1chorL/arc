import type {
  ModelProvider,
  ModelProviderConnectivity,
  ModelProviderDraftMigration,
  ModelProviderDraftMigrationInput,
  ModelProviderImpact,
  ModelProviderType,
} from '../types'
import { apiFetch, readJson } from './http'

export interface CreateModelProviderInput {
  name: string
  providerType: ModelProviderType
  baseUrl: string
  defaultModel: string
  secretRef: string
}

export type UpdateModelProviderInput = Partial<CreateModelProviderInput>

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

export async function getModelProviderImpact(
  workspaceId: string,
  providerId: string,
): Promise<ModelProviderImpact> {
  return readJson<ModelProviderImpact>(await apiFetch(workspacePath(workspaceId, `/${providerId}/impact`)))
}

export async function updateModelProvider(
  workspaceId: string,
  providerId: string,
  input: UpdateModelProviderInput,
): Promise<ModelProvider> {
  return readJson<ModelProvider>(await apiFetch(workspacePath(workspaceId, `/${providerId}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }))
}

export async function deactivateModelProvider(
  workspaceId: string,
  providerId: string,
): Promise<ModelProvider> {
  return readJson<ModelProvider>(await apiFetch(workspacePath(workspaceId, `/${providerId}/deactivate`), {
    method: 'POST',
  }))
}

export async function migrateModelProviderDrafts(
  workspaceId: string,
  providerId: string,
  input: ModelProviderDraftMigrationInput,
): Promise<ModelProviderDraftMigration> {
  return readJson<ModelProviderDraftMigration>(await apiFetch(workspacePath(workspaceId, `/${providerId}/migrate-drafts`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }))
}
