import type {
  ToolSkillAsset,
  ToolSkillAssetCreateInput,
  ToolSkillAssetImpact,
  ToolSkillAssetUpdateInput,
  ToolSkillInvocation,
  ToolSkillTestInvocationInput,
} from '../types'
import { apiFetch, readJson } from './http'

function workspacePath(workspaceId: string, path = '') {
  return `/api/workspaces/${workspaceId}/asset-library${path}`
}

export async function listToolSkillAssets(workspaceId: string): Promise<ToolSkillAsset[]> {
  return readJson<ToolSkillAsset[]>(await apiFetch(workspacePath(workspaceId)))
}

export async function createToolSkillAsset(
  workspaceId: string,
  input: ToolSkillAssetCreateInput,
): Promise<ToolSkillAsset> {
  return readJson<ToolSkillAsset>(await apiFetch(workspacePath(workspaceId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }))
}

export async function testToolSkillAsset(
  workspaceId: string,
  assetId: string,
  input: ToolSkillTestInvocationInput,
): Promise<ToolSkillInvocation> {
  return readJson<ToolSkillInvocation>(await apiFetch(workspacePath(workspaceId, `/${assetId}/test-invocations`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }))
}

export async function updateToolSkillAsset(
  workspaceId: string,
  assetId: string,
  input: ToolSkillAssetUpdateInput,
): Promise<ToolSkillAsset> {
  return readJson<ToolSkillAsset>(await apiFetch(workspacePath(workspaceId, `/${assetId}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }))
}

export async function deactivateToolSkillAsset(
  workspaceId: string,
  assetId: string,
): Promise<ToolSkillAsset> {
  return readJson<ToolSkillAsset>(await apiFetch(workspacePath(workspaceId, `/${assetId}/deactivate`), {
    method: 'POST',
  }))
}

export async function getToolSkillAssetImpact(
  workspaceId: string,
  assetId: string,
): Promise<ToolSkillAssetImpact> {
  return readJson<ToolSkillAssetImpact>(await apiFetch(workspacePath(workspaceId, `/${assetId}/impact`)))
}

export async function listToolSkillInvocations(
  workspaceId: string,
  assetId?: string,
): Promise<ToolSkillInvocation[]> {
  const search = assetId ? `?assetId=${encodeURIComponent(assetId)}` : ''
  return readJson<ToolSkillInvocation[]>(await apiFetch(workspacePath(workspaceId, `/invocations${search}`)))
}
