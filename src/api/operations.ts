import { ApiError, apiFetch, readJson } from './http'
import { isRuntimeMigration } from './migrationCapabilities'

export type OperationStatus = 'queued' | 'running' | 'waiting_review' | 'needs_reconciliation' | 'succeeded' | 'failed' | 'dead_letter' | 'canceled'
export interface AcceptedOperation {
  operationId: string
  status: OperationStatus
  statusUrl: string
  runId?: string
}
export interface Operation extends Omit<AcceptedOperation, 'statusUrl'> {
  kind: string
  result: unknown
  error: unknown
  attempts: number
  createdAt: string
  updatedAt: string
}
export type OperationResult<T> = T | AcceptedOperation
export const operationAcceptedEvent = 'arc-operation-accepted'
export const operationUpdatedEvent = 'arc-operation-updated'

/** Each user submission gets an idempotency key; no mutation is automatically replayed by the browser. */
export function operationRequestHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', ...(isRuntimeMigration() ? { 'Idempotency-Key': crypto.randomUUID() } : {}) }
}
export const operationStatusLabels: Record<OperationStatus, string> = {
  queued: '已接收，排队中', running: '运行中', waiting_review: '等待人工审核',
  needs_reconciliation: '结果待核对', succeeded: '已完成', failed: '失败', dead_letter: '死信', canceled: '已取消',
}

/** Acceptance is not a completed business DTO. */
export function isAcceptedOperation(value: unknown): value is AcceptedOperation {
  return Boolean(value && typeof value === 'object' && 'operationId' in value
    && typeof value.operationId === 'string' && value.operationId.length > 0
    && 'statusUrl' in value && typeof value.statusUrl === 'string'
    && 'status' in value && typeof value.status === 'string' && Object.hasOwn(operationStatusLabels, value.status))
}

/** Preserve legacy responses, but surface native acceptance to the durable task UI. */
export async function readOperationResponse<T>(response: Response, workspaceId: string): Promise<OperationResult<T>> {
  const value = await readJson<T | AcceptedOperation>(response)
  if (response.status !== 202) return value
  if (!isAcceptedOperation(value)) throw new ApiError(202, '异步任务响应格式异常')
  announceOperation(workspaceId, value)
  return value
}

/** A short transaction may attach a distinct, queued continuation without changing its own result. */
export function announceOperation(workspaceId: string, operation: AcceptedOperation) {
  window.dispatchEvent(new CustomEvent(operationAcceptedEvent, { detail: { workspaceId, operation } }))
}

function operationPath(workspaceId: string, operationId: string) {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/operations/${encodeURIComponent(operationId)}`
}

/** Query only the selected workspace endpoint; never follow an arbitrary statusUrl. */
export async function getOperation(workspaceId: string, operationId: string, signal?: AbortSignal): Promise<Operation> {
  return readJson<Operation>(await apiFetch(operationPath(workspaceId, operationId), { signal }))
}

/** Control an existing operation; requeue never substitutes for uncertain-result reconciliation. */
export async function controlOperation(workspaceId: string, operationId: string, action: 'cancel' | 'requeue', reason: string): Promise<Operation> {
  return readJson<Operation>(await apiFetch(`${operationPath(workspaceId, operationId)}/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
  }))
}

/** A retry is a deliberate new attempt, not an exactly-once claim. Server authorization remains authoritative. */
export async function reconcileOperation(workspaceId: string, operationId: string, input: {
  decision: 'retry' | 'fail'; reason: string; acknowledgeDuplicateRisk?: boolean
}): Promise<Operation> {
  if (!input.reason.trim()) throw new Error('请填写核对依据')
  if (input.decision === 'retry' && input.acknowledgeDuplicateRisk !== true) throw new Error('请确认重复调用风险')
  return readJson<Operation>(await apiFetch(`${operationPath(workspaceId, operationId)}/reconcile`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }))
}
