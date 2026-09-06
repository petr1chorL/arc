import { ApiError } from '../identity-workspace/handler.ts'
import type { SqlClient } from '../identity-workspace/postgres.ts'
import { object } from '../workflows/policy.ts'
import { appendOperationEvent, wakeOperation } from './ledger.ts'
import type { Operation } from './types.ts'
import { synchronizeToolTest } from './tool-test.ts'

/** Caller authenticates capabilities; state transition is locked and independently scoped. */
export async function controlOperation(client: SqlClient, workspaceId: string, id: string, action: string, input: unknown, actorId: string): Promise<Operation> {
  const op = (await client.query<Operation>('SELECT * FROM runtime_operations WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [workspaceId, id])).rows[0]
  if (!op) throw new ApiError(404, '任务不存在')
  if (!object(input)) throw new ApiError(422, '操作参数无效')
  const reason = input.reason
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 1000) throw new ApiError(422, '需要填写操作依据')
  let status = op.status, type = action
  if (action === 'cancel') {
    if (['succeeded', 'failed', 'dead_letter', 'canceled'].includes(op.status)) throw new ApiError(409, '任务已结束')
    const unknown=(await client.query("SELECT 1 FROM runtime_effects WHERE operation_id=$1 AND status IN ('started','uncertain') LIMIT 1",[id])).rows.length
    status = unknown?'needs_reconciliation':'canceled'
  } else if (action === 'requeue') {
    if (!['failed', 'dead_letter'].includes(op.status)) throw new ApiError(409, '仅可重投已确认失败的任务')
    if ((await client.query("SELECT 1 FROM runtime_effects WHERE operation_id=$1 AND status IN ('started','uncertain')", [id])).rows.length) throw new ApiError(409, '外部结果未确认，不能直接重投')
    status = 'queued'
  } else if (action === 'reconcile') {
    const unknown = (await client.query("SELECT 1 FROM runtime_effects WHERE operation_id=$1 AND status IN ('started','uncertain')", [id])).rows.length
    if (op.status !== 'needs_reconciliation' && !(op.status === 'canceled' && unknown)) throw new ApiError(409, '任务不处于待核对状态')
    if (!['retry', 'fail'].includes(String(input.decision)) || (input.decision === 'retry' && input.acknowledgeDuplicateRisk !== true)) throw new ApiError(422, '重试前需要确认重复执行风险')
    type = `reconcile.${input.decision}`
    status = input.decision === 'retry' ? 'queued' : 'failed'
    if (input.decision === 'retry') await client.query(`UPDATE runtime_effects SET status='not_sent',attempt=attempt+1,updated_at=now()
      WHERE operation_id=$1 AND status IN ('started','uncertain')`, [id])
  } else throw new ApiError(404, '操作不存在')
  const updated = (await client.query<Operation>(`UPDATE runtime_operations SET status=$3::varchar,generation=generation+1,locked_until=NULL,
    attempts=CASE WHEN $3='queued' THEN 0 ELSE attempts END,error='',available_at=now(),updated_at=now()
    WHERE workspace_id=$1 AND id=$2 RETURNING *`, [workspaceId, id, status])).rows[0]
  await appendOperationEvent(client, updated, type, { reason: reason.trim(), acknowledgeDuplicateRisk: input.acknowledgeDuplicateRisk === true }, actorId)
  if (status === 'queued') await wakeOperation(client, id, `control:${updated.generation}`)
  const runId = ['workflow.run','agent.run'].includes(op.kind) ? op.target_id : op.kind === 'human.resume' || op.kind === 'workflow.resume' ? op.input.runId : null
  if (runId) await client.query(`UPDATE workflow_runs SET status=$3::varchar,error='',completed_at=CASE WHEN $3 IN ('已取消','失败') THEN now() ELSE NULL END
    WHERE workspace_id=$1 AND id=$2`, [workspaceId, runId, action==='cancel' ? '已取消' : status === 'queued' ? '排队中' : '失败'])
  if (updated.kind === 'tool.test') await synchronizeToolTest(client, updated)
  return updated
}
