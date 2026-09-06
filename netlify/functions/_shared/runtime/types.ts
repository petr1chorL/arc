import type { SqlPool } from '../identity-workspace/postgres.ts'

export type OperationStatus = 'queued' | 'running' | 'waiting_review' | 'needs_reconciliation' | 'succeeded' | 'failed' | 'dead_letter' | 'canceled'
export type Operation = Record<string, unknown> & {
  id: string; workspace_id: string; kind: string; idempotency_key: string; request_hash: string
  input: Record<string, unknown>; target_id: string | null; actor_id: string | null
  status: OperationStatus; result: unknown; error: string; attempts: number; max_attempts: number
  generation: number; locked_until: Date | null; created_at: Date; updated_at: Date
}
export type EnqueueInput = { workspaceId: string; kind: string; idempotencyKey: string;
  input: Record<string, unknown>; targetId?: string; actorId?: string }
export type RuntimeContext = {
  pool: SqlPool
  /** One external attempt; throw NotSentError only when the transport was never entered. */
  effect<T>(key: string, input: unknown, send: () => Promise<T>): Promise<T>
  /** A fenced business transaction. Never perform network work inside it. */
  transaction<T>(fn: (client: import('../identity-workspace/postgres.ts').SqlClient) => Promise<T>): Promise<T>
}
export type OperationExecutor = (operation: Operation, context: RuntimeContext) => Promise<unknown>
export class NotSentError extends Error {}
export class UncertainEffectError extends Error {}
export class LostLeaseError extends Error {}
export class RetryableOperationError extends Error {}
export class WaitingReview extends Error {}
export class ContinueOperation extends Error {}
