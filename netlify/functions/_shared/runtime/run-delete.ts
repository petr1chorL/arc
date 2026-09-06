import { ApiError } from '../identity-workspace/handler.ts'
import type { SqlClient } from '../identity-workspace/postgres.ts'

/** Do not reuse legacy cascades: logical references and durable effects need an approved retention contract. */
export async function runDeletionConflict(client: SqlClient, workspaceId: string, runId: string) {
  const row = (await client.query<{ status: string }>(
    'SELECT status FROM workflow_runs WHERE workspace_id=$1 AND id=$2', [workspaceId, runId],
  )).rows[0]
  if (!row) throw new ApiError(404, '运行不存在')
  return {
    status: row.status,
    detail: '运行删除能力尚未迁移；为保留关联业务记录及持久执行账本，本次未删除或取消运行',
  }
}
