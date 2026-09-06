import { ApiError, type BackendResult } from '../identity-workspace/handler.ts'
import { requireCapability, type SqlClient, type WorkspaceContext } from '../identity-workspace/postgres.ts'
import type { ReferenceAssetsInput } from './handler.ts'

type Invocation = { id: string; asset_id: string; asset_type: string; asset_name: string
  agent_id: string | null; agent_version: string; run_id: string | null; node_run_id: string | null
  status: string; input_summary: string; output_summary: string; error: string; duration_ms: number; created_at: Date }
type Audit = { id: string; action: string | null; event_type: string | null; target_type: string | null
  target_id: string | null; outcome: string; actor_user_id: string | null; actor_id: string | null
  reason: string; metadata: unknown; created_at: Date }
const HIDDEN = '内容已隐藏（迁移安全策略）'
const known = new Set(['model_provider', 'tool_skill_asset'].flatMap(domain =>
  ['create','update','deactivate','list','impact','audit_events'].map(verb => `${domain}.${verb}`)))
known.add('model_provider.migrate_drafts')
known.add('tool_skill_asset.test_invoke')

export async function readAssetHistory(
  client: SqlClient, context: WorkspaceContext, input: ReferenceAssetsInput,
): Promise<BackendResult> {
  const { kind, operation, params } = input.route
  const provider = kind === 'provider'
  const targetType = provider ? 'model_provider' : 'tool_skill_asset'
  const listing = operation === 'invocations'
  await requireCapability(client, context, input, listing ? 'asset.read' : 'audit.read', {
    action: listing ? 'tool_skill_asset_invocation.list' : `${targetType}.audit_events`,
    targetType: listing ? 'workspace' : targetType,
    targetId: listing ? context.workspace.id : params.assetId ?? null,
  })
  const search = new URL(input.request.url).searchParams
  if (listing) {
    const values: unknown[] = [context.workspace.id]
    const filters = ['workspace_id=$1']
    for (const [parameter, column] of [['assetId','asset_id'], ['agentId','agent_id'], ['status','status']]) {
      const value = search.get(parameter)
      if (value) { values.push(value); filters.push(`${column}=$${values.length}`) }
    }
    const rows = (await client.query<Invocation>(`SELECT * FROM tool_skill_asset_invocations
      WHERE ${filters.join(' AND ')} ORDER BY created_at DESC`, values)).rows
    const projected = []
    for (const row of rows) projected.push(await projectInvocation(client, context, row))
    return { body: projected }
  }
  const rawLimit = search.get('limit') ?? (provider ? '10' : '20')
  const limit = Number(rawLimit)
  if (!/^[+]?[0-9]+$/.test(rawLimit) || !Number.isSafeInteger(limit) || limit < 1 || limit > (provider ? 50 : 100)) {
    throw new ApiError(422, '资产请求字段不符合要求')
  }
  const exists = await client.query(provider
    ? 'SELECT id FROM model_providers WHERE id=$1 AND workspace_id=$2'
    : 'SELECT id FROM tool_skill_assets WHERE id=$1 AND workspace_id=$2', [params.assetId, context.workspace.id])
  if (!exists.rows[0]) throw new ApiError(404, provider ? '模型 Provider 不存在' : 'Tool / Skill 资产不存在')
  let rows: Audit[]
  if (provider) {
    // Preserve the legacy latest-200-workspace-events window before relevance filtering.
    const candidates = (await client.query<Audit>(`SELECT * FROM audit_events WHERE workspace_id=$1
      ORDER BY created_at DESC,id DESC LIMIT 200`, [context.workspace.id])).rows
    rows = candidates.filter(row => {
      const metadata = objectMetadata(row.metadata)
      return (row.target_type === 'model_provider' && row.target_id === params.assetId)
        || metadata.targetProviderId === params.assetId || metadata.sourceProviderId === params.assetId
    }).slice(0, limit)
  } else {
    rows = (await client.query<Audit>(`SELECT * FROM audit_events WHERE workspace_id=$1
      AND target_type='tool_skill_asset' AND target_id=$2 ORDER BY created_at DESC,id DESC LIMIT $3`,
    [context.workspace.id, params.assetId, limit])).rows
  }
  const events = []
  for (const row of rows) events.push(await projectAudit(client, context, row))
  if (!provider) {
    const invocations = (await client.query<Invocation>(`SELECT * FROM tool_skill_asset_invocations
      WHERE workspace_id=$1 AND asset_id=$2 ORDER BY created_at DESC,id DESC LIMIT $3`,
    [context.workspace.id, params.assetId, limit])).rows
    for (const row of invocations) {
      const invocation = await projectInvocation(client, context, row)
      const { id, status, error, createdAt, ...metadata } = invocation
      events.push({ id, eventType: 'tool_skill_asset.invocation', targetType: 'tool_skill_asset_invocation',
        targetId: id, outcome: status, reason: error, actorId: null, createdAt, metadata })
    }
    events.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
  }
  return { body: events.slice(0, limit) }
}

async function projectInvocation(client: SqlClient, context: WorkspaceContext, row: Invocation) {
  await scoped(client, 'tool_skill_assets', row.asset_id, context.workspace.id)
  for (const [table, value] of [['agents', row.agent_id], ['workflow_runs', row.run_id], ['node_runs', row.node_run_id]] as const) {
    if (value !== null) await scoped(client, table, value, context.workspace.id)
  }
  if (!['tool','skill'].includes(row.asset_type) || !['succeeded','failed'].includes(row.status)
    || !Number.isInteger(row.duration_ms) || row.duration_ms < 0) throw historical()
  return { id: row.id, assetId: row.asset_id, assetType: row.asset_type, assetName: hide(row.asset_name),
    agentId: row.agent_id, agentVersion: hide(row.agent_version), runId: row.run_id, nodeRunId: row.node_run_id,
    status: row.status, inputSummary: hide(row.input_summary), outputSummary: hide(row.output_summary),
    error: hide(row.error), durationMs: row.duration_ms, createdAt: row.created_at }
}

async function projectAudit(client: SqlClient, context: WorkspaceContext, row: Audit) {
  const raw = objectMetadata(row.metadata)
  if (!['success', 'denied'].includes(row.outcome)
    || !['model_provider', 'tool_skill_asset', 'workspace'].includes(row.target_type ?? '')) throw historical()
  if (row.target_id !== null) {
    if (row.target_type === 'workspace') {
      if (row.target_id !== context.workspace.id) throw historical()
    } else {
      await scoped(client, row.target_type === 'model_provider' ? 'model_providers' : 'tool_skill_assets',
        row.target_id, context.workspace.id)
    }
  }
  const action = row.action || row.event_type || ''
  let metadata: Record<string, unknown> = {}
  if (action === 'model_provider.migrate_drafts' && row.outcome === 'success') {
    for (const key of ['sourceProviderId', 'targetProviderId']) {
      metadata[key] = await scoped(client, 'model_providers', raw[key], context.workspace.id)
    }
    if (!Array.isArray(raw.migratedAgentIds)) throw historical()
    const ids = []
    for (const id of raw.migratedAgentIds) ids.push(await scoped(client, 'agents', id, context.workspace.id))
    metadata.migratedAgentIds = ids
    metadata.reason = hide(Object.hasOwn(raw, 'reason') ? raw.reason : '')
  }
  if (row.outcome === 'denied' && known.has(action)) {
    if (typeof raw.capability !== 'string' || !['agent.write','asset.read','asset.deactivate','audit.read'].includes(raw.capability)) {
      throw historical()
    }
    metadata = { capability: raw.capability }
  }
  const actorId = row.actor_user_id || row.actor_id || null
  if (actorId) {
    const actor = await client.query('SELECT id FROM users WHERE id=$1 AND organization_id=$2',
      [actorId, context.organizationId])
    if (!actor.rows[0]) throw historical()
  }
  return { id: row.id, eventType: known.has(action) ? action : 'unsupported_event',
    targetType: row.target_type || '', targetId: row.target_id || '', outcome: row.outcome || '', actorId,
    createdAt: row.created_at,
    reason: known.has(action) ? hide(row.reason || (Object.hasOwn(raw, 'reason') ? raw.reason : '')) : HIDDEN, metadata }
}

async function scoped(client: SqlClient, table: 'tool_skill_assets' | 'agents' | 'workflow_runs' | 'node_runs' | 'model_providers',
  id: unknown, workspaceId: string): Promise<string> {
  if (typeof id !== 'string') throw historical()
  const result = await client.query(`SELECT id FROM ${table} WHERE id=$1 AND workspace_id=$2`, [id, workspaceId])
  if (!result.rows[0]) throw historical()
  return id
}
function hide(value: unknown): string {
  if (typeof value !== 'string') throw historical()
  return value ? HIDDEN : ''
}
function objectMetadata(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw historical()
  return value as Record<string, unknown>
}
function historical() { return new ApiError(409, '存在不符合当前安全规则的历史资产或记录，需先完成治理') }
