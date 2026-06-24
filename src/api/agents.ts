import type { Agent } from '../types'
import type { AgentVersion } from '../types'
import { ApiError, readJson } from './http'

export interface CreateAgentInput {
  name: string
  role: string
  owner: string
  model: string
}

export { ApiError as AgentApiError }

export async function listAgents(): Promise<Agent[]> {
  const response = await fetch('/api/agents')
  return readJson<Agent[]>(response)
}

export async function createAgent(input: CreateAgentInput): Promise<Agent> {
  const response = await fetch('/api/agents', {
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

export async function getAgent(agentId: string): Promise<Agent> {
  return readJson<Agent>(await fetch(`/api/agents/${agentId}`))
}

export async function updateAgent(agentId: string, input: UpdateAgentInput): Promise<Agent> {
  return readJson<Agent>(await fetch(`/api/agents/${agentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }))
}

export async function listAgentVersions(agentId: string): Promise<AgentVersion[]> {
  return readJson<AgentVersion[]>(await fetch(`/api/agents/${agentId}/versions`))
}

export async function publishAgent(agentId: string): Promise<AgentVersion> {
  return readJson<AgentVersion>(await fetch(`/api/agents/${agentId}/publish`, {
    method: 'POST',
  }))
}

export async function deactivateAgent(agentId: string): Promise<Agent> {
  return readJson<Agent>(await fetch(`/api/agents/${agentId}/deactivate`, {
    method: 'POST',
  }))
}
