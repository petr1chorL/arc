import type { Agent } from '../types'

export interface CreateAgentInput {
  name: string
  role: string
  owner: string
  model: string
}

export class AgentApiError extends Error {
  readonly status: number

  constructor(
    status: number,
    message: string,
  ) {
    super(message)
    this.name = 'AgentApiError'
    this.status = status
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json() as T | { detail?: string }
  if (!response.ok) {
    const message = 'detail' in (data as object)
      ? (data as { detail?: string }).detail ?? 'Agent 请求失败'
      : 'Agent 请求失败'
    throw new AgentApiError(response.status, message)
  }
  return data as T
}

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
