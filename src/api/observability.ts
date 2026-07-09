import type {
  CostUsageOverview,
  HumanSlaOverview,
  ObservabilityExecutionEvent,
  ObservabilityOverview,
  ObservabilityRunDetail,
} from '../types'
import { apiFetch, readJson } from './http'

function workspacePath(workspaceId: string, path = '') {
  return `/api/workspaces/${workspaceId}/observability${path}`
}

export async function getObservabilityOverview(workspaceId: string): Promise<ObservabilityOverview> {
  return readJson<ObservabilityOverview>(await apiFetch(workspacePath(workspaceId, '/overview')))
}

export async function getObservabilityRunDetail(
  workspaceId: string,
  runId: string,
): Promise<ObservabilityRunDetail> {
  return readJson<ObservabilityRunDetail>(await apiFetch(workspacePath(workspaceId, `/runs/${runId}`)))
}

export interface ExecutionEventFilters {
  runId?: string
  traceId?: string
}

export async function listExecutionEvents(
  workspaceId: string,
  filters: ExecutionEventFilters = {},
): Promise<ObservabilityExecutionEvent[]> {
  const params = new URLSearchParams()
  if (filters.runId) params.set('runId', filters.runId)
  if (filters.traceId) params.set('traceId', filters.traceId)
  const query = params.toString()
  return readJson<ObservabilityExecutionEvent[]>(
    await apiFetch(workspacePath(workspaceId, `/execution-events${query ? `?${query}` : ''}`)),
  )
}

export interface HumanSlaOverviewFilters {
  reviewerId?: string
  groupId?: string
}

export async function getHumanSlaOverview(
  workspaceId: string,
  filters: HumanSlaOverviewFilters = {},
): Promise<HumanSlaOverview> {
  const params = new URLSearchParams()
  if (filters.reviewerId) params.set('reviewerId', filters.reviewerId)
  if (filters.groupId) params.set('groupId', filters.groupId)
  const query = params.toString()
  return readJson<HumanSlaOverview>(
    await apiFetch(workspacePath(workspaceId, `/human-sla${query ? `?${query}` : ''}`)),
  )
}

export async function getCostUsageOverview(workspaceId: string): Promise<CostUsageOverview> {
  return readJson<CostUsageOverview>(await apiFetch(workspacePath(workspaceId, '/cost-usage')))
}
