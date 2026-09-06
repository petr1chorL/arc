import { createHash, randomUUID } from 'node:crypto'
import { ApiError } from '../identity-workspace/handler.ts'
import type { SqlClient, SqlPool } from '../identity-workspace/postgres.ts'
import type { EnqueueInput, Operation } from './types.ts'

/** Key-order-independent JSON identity; secrets must never be part of persisted inputs. */
export function requestHash(value: unknown): string {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])])) : value
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

/** Caller owns one business transaction, including its outbox write. */
export async function enqueueOperation(client: SqlClient, input: EnqueueInput): Promise<Operation> {
  if (!input.idempotencyKey || input.idempotencyKey.length > 200 || input.kind.length > 80) throw new ApiError(422, '任务幂等键不符合要求')
  const digest = requestHash({ input: input.input, actorId: input.actorId ?? null })
  const created = await client.query<Operation>(`INSERT INTO runtime_operations
    (id,workspace_id,kind,idempotency_key,request_hash,input,target_id,actor_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(workspace_id,kind,idempotency_key) DO NOTHING RETURNING *`,
  [randomUUID(), input.workspaceId, input.kind, input.idempotencyKey, digest, JSON.stringify(input.input), input.targetId ?? null, input.actorId ?? null])
  const operation = created.rows[0] ?? (await client.query<Operation>(
    'SELECT * FROM runtime_operations WHERE workspace_id=$1 AND kind=$2 AND idempotency_key=$3', [input.workspaceId, input.kind, input.idempotencyKey])).rows[0]
  if (!operation || operation.request_hash !== digest) throw new ApiError(409, '幂等键已用于不同请求')
  if (created.rows.length) {
    await wakeOperation(client, operation.id, 'created')
    await appendOperationEvent(client, operation, 'accepted')
  }
  return operation
}

/** Use stable dispatch keys; a duplicate AWL send remains safe at claim time. */
export async function wakeOperation(client: SqlClient, operationId: string, key: string, availableAt = new Date()) {
  await client.query(`INSERT INTO runtime_event_outbox(id,operation_id,dispatch_key,available_at)
    VALUES($1,$2,$3,$4) ON CONFLICT(dispatch_key) DO NOTHING`, [randomUUID(), operationId, `${operationId}:${key}`, availableAt])
}

export async function appendOperationEvent(client: SqlClient, operation: Operation, type: string, details: unknown = {}, actorId = operation.actor_id) {
  await client.query(`INSERT INTO runtime_operation_events(id,operation_id,workspace_id,event_type,actor_id,details)
    VALUES($1,$2,$3,$4,$5,$6)`, [randomUUID(), operation.id, operation.workspace_id, type, actorId, JSON.stringify(details)])
}

/** Never hold an open business transaction while awaiting external effects. */
export async function runtimeWithTransaction<T>(pool: SqlPool, fn: (client: SqlClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    try { const value = await fn(client); await client.query('COMMIT'); return value }
    catch (error) { await client.query('ROLLBACK'); throw error }
  } finally { client.release() }
}

/** Public projection intentionally omits persisted input, keys and transport details. */
export function projectOperation(operation: Operation) {
  return { operationId: operation.id, kind: operation.kind, status: operation.status,
    result: operation.result, error: operation.error, runId: ['workflow.run','agent.run'].includes(operation.kind) ? operation.target_id
      : ['workflow.resume','human.resume'].includes(operation.kind) ? operation.input.runId : undefined,
    attempts: operation.attempts, createdAt: new Date(operation.created_at).toISOString(), updatedAt: new Date(operation.updated_at).toISOString(),
    statusUrl: `/api/workspaces/${encodeURIComponent(operation.workspace_id)}/operations/${encodeURIComponent(operation.id)}` }
}
