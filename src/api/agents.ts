import type { Agent } from '../types'
import type { AgentVersion } from '../types'
import { ApiError, apiFetch, readJson } from './http'

export interface CreateAgentInput {
  name: string
  role: string
  owner: string
  model: string
  modelProvider?: string
  modelBaseUrl?: string
  temperature?: number
  maxOutputTokens?: number
}

export { ApiError as AgentApiError }

function workspacePath(workspaceId: string, path = '') {
  return `/api/workspaces/${workspaceId}/agents${path}`
}

export async function listAgents(workspaceId: string): Promise<Agent[]> {
  const response = await apiFetch(workspacePath(workspaceId))
  return readJson<Agent[]>(response)
}

export async function createAgent(workspaceId: string, input: CreateAgentInput): Promise<Agent> {
  const response = await apiFetch(workspacePath(workspaceId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return readJson<Agent>(response)
}

export interface UpdateAgentInput extends CreateAgentInput {
  systemPrompt: string
  tools: string[]
  skills: string[]
}

export async function getAgent(workspaceId: string, agentId: string): Promise<Agent> {
  return readJson<Agent>(await apiFetch(workspacePath(workspaceId, `/${agentId}`)))
}

export async function updateAgent(
  workspaceId: string,
  agentId: string,
  input: UpdateAgentInput,
): Promise<Agent> {
  return readJson<Agent>(await apiFetch(workspacePath(workspaceId, `/${agentId}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }))
}

export async function listAgentVersions(workspaceId: string, agentId: string): Promise<AgentVersion[]> {
  return readJson<AgentVersion[]>(await apiFetch(workspacePath(workspaceId, `/${agentId}/versions`)))
}

export async function publishAgent(workspaceId: string, agentId: string): Promise<AgentVersion> {
  return readJson<AgentVersion>(await apiFetch(workspacePath(workspaceId, `/${agentId}/publish`), {
    method: 'POST',
  }))
}

export async function deactivateAgent(workspaceId: string, agentId: string): Promise<Agent> {
  return readJson<Agent>(await apiFetch(workspacePath(workspaceId, `/${agentId}/deactivate`), {
    method: 'POST',
  }))
}
