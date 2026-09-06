import { randomUUID } from 'node:crypto'
import { ApiError, type BackendResult } from '../identity-workspace/handler.ts'
import { recordAudit, requireCapability, type SqlClient, type WorkspaceContext } from '../identity-workspace/postgres.ts'
import { enqueueOperation, projectOperation } from '../runtime/ledger.ts'
import type { ReferenceAssetsInput } from './handler.ts'
import { validateAdapterConfig } from './policy.ts'

/** Receives a standalone test; the surrounding transaction owns all persisted acceptance records. */
export async function submitToolTest(client: SqlClient, context: WorkspaceContext, input: ReferenceAssetsInput): Promise<BackendResult> {
  const assetId = input.route.params.assetId ?? ''
  const audit = { action: 'tool_skill_asset.test_invoke', targetType: 'tool_skill_asset', targetId: assetId }
  await requireCapability(client, context, input, 'agent.write', audit)
  if (!assetId || Array.from(assetId).length > 36) throw new ApiError(404, '资产不存在')
  const parameters = parseToolTestParameters(input.body)
  const operation = await enqueueOperation(client, { workspaceId: context.workspace.id, kind: 'tool.test',
    actorId: context.user.id, targetId: assetId, idempotencyKey: input.request.headers.get('Idempotency-Key') ?? randomUUID(),
    input: { assetId, parameters } })
  // A successful conflicting insert waits for the first transaction, including its immutable snapshot.
  const old = (await client.query('SELECT operation_id FROM runtime_tool_test_snapshots WHERE operation_id=$1 AND workspace_id=$2',
    [operation.id, context.workspace.id])).rows[0]
  if (!old) {
    const asset = (await client.query('SELECT * FROM tool_skill_assets WHERE id=$1 AND workspace_id=$2 FOR SHARE',
      [assetId, context.workspace.id])).rows[0]
    if (!asset) throw new ApiError(404, '资产不存在')
    if (asset.asset_type !== 'tool' || !['http', 'mcp'].includes(String(asset.adapter_type))) throw new ApiError(422, '仅 HTTP / MCP Tool 支持测试调用')
    if (asset.status !== 'active') throw new ApiError(409, '工具已停用，未受理测试')
    try { validateAdapterConfig(String(asset.adapter_type), asset.adapter_config) }
    catch { throw new ApiError(409, '工具配置未通过安全治理') }
    const snapshot = { assetId, assetName: asset.name, assetType: asset.asset_type,
      adapterType: asset.adapter_type, adapterConfig: asset.adapter_config, status: asset.status }
    await client.query(`INSERT INTO runtime_tool_test_snapshots(operation_id,workspace_id,asset_id,asset_snapshot)
      VALUES($1,$2,$3,$4)`, [operation.id, context.workspace.id, assetId, JSON.stringify(snapshot)])
    await client.query(`INSERT INTO tool_skill_asset_invocations
      (id,workspace_id,asset_id,asset_type,asset_name,agent_id,agent_version,run_id,node_run_id,status,
       input_summary,output_summary,error,duration_ms,created_at,effect_operation_id)
      VALUES($1,$2,$3,'tool',$4,NULL,'',NULL,NULL,'pending',$5,'','',0,now(),$1)`,
    [operation.id, context.workspace.id, assetId, asset.name, JSON.stringify(parameters).slice(0,1000)])
    await recordAudit(client, context, input, { ...audit, workspaceId: context.workspace.id, outcome: 'success',
      metadata: { phase: 'accepted', operationId: operation.id, invocationId: operation.id } })
  }
  return { status: 202, body: { ...projectOperation(operation), invocationId: operation.id } }
}

/** Bound JSON recursion before canonical hashing; credentials are not an accepted transport configuration. */
export function parseToolTestParameters(value: unknown): Record<string, unknown> {
  if (!object(value) || Object.keys(value).some(key => key !== 'parameters')) throw new ApiError(422, '测试调用参数无效')
  const parameters = Object.hasOwn(value, 'parameters') ? value.parameters : {}
  if (!object(parameters)) throw new ApiError(422, '测试调用参数必须为 JSON object')
  const stack: { value: unknown; depth: number }[] = [{ value: parameters, depth: 0 }]
  while (stack.length) {
    const current = stack.pop()!
    if (current.depth > 32) throw new ApiError(422, '测试参数嵌套超过上限')
    if (current.value && typeof current.value === 'object') {
      for (const child of Object.values(current.value)) stack.push({ value: child, depth: current.depth + 1 })
    }
  }
  if (Buffer.byteLength(JSON.stringify(parameters), 'utf8') > 65536) throw new ApiError(422, '测试参数超过上限')
  return parameters
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
