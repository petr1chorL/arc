import type {
  ValidationResult,
  WorkflowDraft,
  WorkflowVersion,
} from '../types'
import { readJson } from './http'

export interface SaveWorkflowInput {
  name: string
  nodes: WorkflowDraft['nodes']
  edges: WorkflowDraft['edges']
}

export async function listWorkflows(): Promise<WorkflowDraft[]> {
  return readJson<WorkflowDraft[]>(await fetch('/api/workflows'))
}

export async function createWorkflow(input: SaveWorkflowInput): Promise<WorkflowDraft> {
  return readJson<WorkflowDraft>(await fetch('/api/workflows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }))
}

export async function updateWorkflow(
  workflowId: string,
  input: SaveWorkflowInput,
): Promise<WorkflowDraft> {
  return readJson<WorkflowDraft>(await fetch(`/api/workflows/${workflowId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }))
}

export async function validateWorkflow(workflowId: string): Promise<ValidationResult> {
  return readJson<ValidationResult>(await fetch(`/api/workflows/${workflowId}/validate`, {
    method: 'POST',
  }))
}

export async function publishWorkflow(workflowId: string): Promise<WorkflowVersion> {
  return readJson<WorkflowVersion>(await fetch(`/api/workflows/${workflowId}/publish`, {
    method: 'POST',
  }))
}

export async function listWorkflowVersions(workflowId: string): Promise<WorkflowVersion[]> {
  return readJson<WorkflowVersion[]>(await fetch(`/api/workflows/${workflowId}/versions`))
}
