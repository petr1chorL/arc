import type {
  ValidationResult,
  WorkflowDraft,
  WorkflowVersion,
} from '../types'
import { apiFetch, readJson } from './http'

export interface SaveWorkflowInput {
  name: string
  nodes: WorkflowDraft['nodes']
  edges: WorkflowDraft['edges']
}

function workspacePath(workspaceId: string, path = '') {
  return `/api/workspaces/${workspaceId}/workflows${path}`
}

export async function listWorkflows(workspaceId: string): Promise<WorkflowDraft[]> {
  return readJson<WorkflowDraft[]>(await apiFetch(workspacePath(workspaceId)))
}

export async function createWorkflow(workspaceId: string, input: SaveWorkflowInput): Promise<WorkflowDraft> {
  return readJson<WorkflowDraft>(await apiFetch(workspacePath(workspaceId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }))
}

export async function updateWorkflow(
  workspaceId: string,
  workflowId: string,
  input: SaveWorkflowInput,
): Promise<WorkflowDraft> {
  return readJson<WorkflowDraft>(await apiFetch(workspacePath(workspaceId, `/${workflowId}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }))
}

export async function validateWorkflow(workspaceId: string, workflowId: string): Promise<ValidationResult> {
  return readJson<ValidationResult>(await apiFetch(workspacePath(workspaceId, `/${workflowId}/validate`), {
    method: 'POST',
  }))
}

export async function publishWorkflow(workspaceId: string, workflowId: string): Promise<WorkflowVersion> {
  return readJson<WorkflowVersion>(await apiFetch(workspacePath(workspaceId, `/${workflowId}/publish`), {
    method: 'POST',
  }))
}

export async function listWorkflowVersions(workspaceId: string, workflowId: string): Promise<WorkflowVersion[]> {
  return readJson<WorkflowVersion[]>(await apiFetch(workspacePath(workspaceId, `/${workflowId}/versions`)))
}
