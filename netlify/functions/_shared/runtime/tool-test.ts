import { ApiError } from '../identity-workspace/handler.ts'
import type { SqlClient } from '../identity-workspace/postgres.ts'
import { parseToolTestParameters } from '../reference-assets/tool-test-postgres.ts'
import { validateAdapterConfig } from '../reference-assets/policy.ts'
import { invokeHttpTool, validateHttpToolTarget, type HttpToolOptions, type HttpToolResult } from './http-tool-transport.ts'
import type { Operation, RuntimeContext } from './types.ts'

const diagnostics: Record<string, string> = {
  asset_disabled: '工具已停用，未执行', target_not_allowed: 'HTTP Tool 地址未获准，未执行',
  mcp_not_configured: 'MCP Tool 网关未配置，未执行', http_rejected: 'HTTP Tool 请求被拒绝',
  needs_reconciliation: '工具调用结果待核对', canceled: '测试已取消，未撤回已发送动作',
  execution_failed: '工具测试执行失败',
}

/** Standalone Tool test has its own immutable snapshot and no Agent/Run side effects. */
export async function executeToolTest(op: Operation, ctx: RuntimeContext, options: HttpToolOptions = { allowedBindings: [] }) {
  const snapshot = await ctx.transaction(async client => {
    const row = (await client.query(`SELECT s.asset_snapshot FROM runtime_tool_test_snapshots s
      JOIN tool_skill_asset_invocations i ON i.id=s.operation_id AND i.workspace_id=s.workspace_id AND i.asset_id=s.asset_id
      WHERE s.operation_id=$1 AND s.workspace_id=$2 AND s.asset_id=$3 AND i.effect_operation_id=$1
      AND i.agent_id IS NULL AND i.run_id IS NULL AND i.node_run_id IS NULL`, [op.id, op.workspace_id, op.target_id])).rows[0]
    if (!row || !object(row.asset_snapshot)) throw new ApiError(409, '工具测试快照关联无效')
    return row.asset_snapshot
  })
  if (snapshot.assetId !== op.target_id || snapshot.assetType !== 'tool' || !object(snapshot.adapterConfig)
    || !['http','mcp'].includes(String(snapshot.adapterType))) throw new ApiError(409, '工具测试快照无效')
  try { validateAdapterConfig(String(snapshot.adapterType), snapshot.adapterConfig) }
  catch { throw new ApiError(409, '工具测试快照无效') }
  const parameters = parseToolTestParameters({ parameters: op.input.parameters })
  if (snapshot.adapterType === 'mcp') return failTest(ctx, op, 'mcp_not_configured')
  let receipt: HttpToolResult
  try {
    receipt = await ctx.effect<HttpToolResult>(`tool:${op.id}`, { assetId: op.target_id, config: snapshot.adapterConfig, parameters },
      () => invokeHttpTool(snapshot.adapterConfig as Record<string, unknown>, parameters, op.workspace_id, op.id, options), async client => {
        // Deactivation takes UPDATE on this row; authorization and the new intention commit together.
        const current = (await client.query('SELECT status FROM tool_skill_assets WHERE id=$1 AND workspace_id=$2 FOR SHARE', [op.target_id, op.workspace_id])).rows[0]
        if (current?.status !== 'active') throw new ToolTestRejected('asset_disabled')
        try { validateHttpToolTarget(snapshot.adapterConfig as Record<string, unknown>, op.workspace_id, options) }
        catch { throw new ToolTestRejected('target_not_allowed') }
      })
  } catch (error) {
    if (error instanceof ToolTestRejected) return failTest(ctx, op, error.message)
    throw error
  }
  await ctx.transaction(async client => {
    await client.query(`UPDATE tool_skill_asset_invocations SET output_summary=$3,error=$4,duration_ms=$5
      WHERE id=$1 AND workspace_id=$2`, [op.id, op.workspace_id, receipt.outputSummary,
      receipt.status === 'failed' ? diagnostics.http_rejected : '', receipt.durationMs])
  })
  if (receipt.status === 'failed') throw new Error('工具测试未通过')
  return { invocationId: op.id, status: 'succeeded' }
}

async function failTest(ctx: RuntimeContext, op: Operation, code: string): Promise<never> {
  await ctx.transaction(client => client.query('UPDATE tool_skill_asset_invocations SET error=$3 WHERE id=$1 AND workspace_id=$2',
    [op.id, op.workspace_id, diagnostics[code] ?? diagnostics.execution_failed]))
  throw new Error('工具测试未通过')
}

/** Called in the same transaction as worker/control transitions, not only on the happy execution path. */
export async function synchronizeToolTest(client: SqlClient, op: Operation) {
  if (op.kind !== 'tool.test') return
  const row = (await client.query(`SELECT i.error FROM tool_skill_asset_invocations i JOIN runtime_tool_test_snapshots s
    ON s.operation_id=i.id AND s.workspace_id=i.workspace_id AND s.asset_id=i.asset_id
    WHERE i.id=$1 AND i.workspace_id=$2 AND i.effect_operation_id=$1 AND i.asset_id=$3
    AND i.agent_id IS NULL AND i.run_id IS NULL AND i.node_run_id IS NULL FOR UPDATE OF i`, [op.id, op.workspace_id, op.target_id])).rows[0]
  if (!row) throw new ApiError(409, '工具测试调用关联无效')
  const status = ['queued','waiting_review'].includes(op.status) ? 'pending'
    : op.status === 'dead_letter' ? 'failed' : op.status
  const errorCode = status === 'needs_reconciliation' ? 'needs_reconciliation' : status === 'canceled' ? 'canceled'
    : status === 'failed' ? Object.keys(diagnostics).find(code => diagnostics[code] === row.error) ?? 'execution_failed' : undefined
  const error = errorCode ? diagnostics[errorCode] : ''
  await client.query('UPDATE tool_skill_asset_invocations SET status=$3,error=$4 WHERE id=$1 AND workspace_id=$2', [op.id, op.workspace_id, status, error])
  op.result = { invocationId: op.id, status, ...(errorCode ? { errorCode } : {}) }
  op.error = error
  await client.query('UPDATE runtime_operations SET result=$3,error=$4 WHERE id=$1 AND workspace_id=$2', [op.id, op.workspace_id, JSON.stringify(op.result), error])
}

export function toolTestDiagnostic(value: unknown): string {
  return typeof value === 'string' && Object.values(diagnostics).includes(value) ? value : value ? diagnostics.execution_failed : ''
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
class ToolTestRejected extends Error {}
