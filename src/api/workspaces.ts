import type { WorkspaceSummary } from '../types'
import { apiFetch, readJson } from './http'

export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
  return readJson<WorkspaceSummary[]>(await apiFetch('/api/workspaces'))
}
