import { apiFetch, readJson } from './http'

export interface WorkflowSchedule {
  id: string
  name: string
  workflowId: string
  workflowName: string
  workflowVersionId: string
  workflowVersion: string
  cronExpression: string
  timezone: string
  input: string
  status: 'active' | 'paused'
  nextRunAt: string | null
  lastScheduledFor: string | null
  lastRunId: string | null
  lastRunStatus: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface WorkflowScheduleInput {
  name: string
  workflowId: string
  workflowVersion: string
  cronExpression: string
  timezone: string
  input: string
  status?: 'active' | 'paused'
}

export interface ScheduleDispatch {
  id: string
  scheduleId: string
  scheduledFor: string
  status: 'dispatching' | 'enqueued' | 'skipped' | 'failed'
  runId: string | null
  runStatus: string | null
  reason: string
  createdAt: string
}

function schedulePath(workspaceId: string, path = '') {
  return `/api/workspaces/${workspaceId}/schedules${path}`
}

export async function listSchedules(workspaceId: string): Promise<WorkflowSchedule[]> {
  return readJson<WorkflowSchedule[]>(await apiFetch(schedulePath(workspaceId)))
}

export async function createSchedule(
  workspaceId: string,
  input: WorkflowScheduleInput,
): Promise<WorkflowSchedule> {
  return readJson<WorkflowSchedule>(await apiFetch(schedulePath(workspaceId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }))
}

export async function updateSchedule(
  workspaceId: string,
  scheduleId: string,
  input: Partial<WorkflowScheduleInput>,
): Promise<WorkflowSchedule> {
  return readJson<WorkflowSchedule>(await apiFetch(schedulePath(workspaceId, `/${scheduleId}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }))
}

export async function setScheduleStatus(
  workspaceId: string,
  scheduleId: string,
  status: 'active' | 'paused',
): Promise<WorkflowSchedule> {
  const action = status === 'active' ? 'resume' : 'pause'
  return readJson<WorkflowSchedule>(await apiFetch(schedulePath(workspaceId, `/${scheduleId}/${action}`), {
    method: 'POST',
  }))
}

export async function triggerSchedule(
  workspaceId: string,
  scheduleId: string,
): Promise<ScheduleDispatch> {
  return readJson<ScheduleDispatch>(await apiFetch(schedulePath(workspaceId, `/${scheduleId}/trigger`), {
    method: 'POST',
  }))
}

export async function listScheduleDispatches(
  workspaceId: string,
  scheduleId: string,
): Promise<ScheduleDispatch[]> {
  return readJson<ScheduleDispatch[]>(await apiFetch(schedulePath(workspaceId, `/${scheduleId}/dispatches`)))
}
