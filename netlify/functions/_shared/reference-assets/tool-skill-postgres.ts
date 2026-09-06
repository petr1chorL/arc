import { randomUUID } from 'node:crypto'
import { ApiError, type BackendResult } from '../identity-workspace/handler.ts'
import { requireCapability, recordAudit, type SqlClient, type WorkspaceContext } from '../identity-workspace/postgres.ts'
import type { ReferenceAssetsInput } from './handler.ts'
import { AssetConfigurationError, validateAdapterConfig } from './policy.ts'

type ToolFields = {
  asset_type: string; name: string; description: string; parameter_schema: Record<string, unknown>
  adapter_type: string; adapter_config: Record<string, unknown>
}
type ToolRow = ToolFields & {
  id: string; workspace_id: string; status: string; created_by: string
  created_at: Date | string; updated_at: Date | string
}
const aliases = { asset_type: 'assetType', name: 'name', description: 'description',
  parameter_schema: 'parameterSchema', adapter_type: 'adapterType', adapter_config: 'adapterConfig' } as const
const HISTORY_ERROR = '存在不符合当前安全规则的历史资产或记录，需先完成治理'

export async function dispatchToolSkill(
  client: SqlClient, context: WorkspaceContext, input: ReferenceAssetsInput,
): Promise<BackendResult> {
  const { operation, params } = input.route
  if (!['list', 'create', 'update', 'deactivate'].includes(operation)) {
    throw new ApiError(501, '该资产接口尚未完成迁移')
  }
  const audit = { action: `tool_skill_asset.${operation}`,
    targetType: operation === 'list' ? 'workspace' : 'tool_skill_asset',
    targetId: operation === 'list' ? context.workspace.id : params.assetId ?? null }
  await requireCapability(client, context, input, operation === 'list' ? 'asset.read'
    : operation === 'deactivate' ? 'asset.deactivate' : 'agent.write', audit)
  if (operation === 'list') {
    const result = await client.query<ToolRow>(
      'SELECT * FROM tool_skill_assets WHERE workspace_id=$1 ORDER BY created_at DESC', [context.workspace.id])
    result.rows.forEach(row => requireConfig(row, true))
    return { body: result.rows.map(project) }
  }
  let asset: ToolRow
  if (operation === 'create') {
    const data = parseFields(input.body, false) as ToolFields
    requireConfig(data)
    const now = new Date()
    asset = { ...data, id: randomUUID(), workspace_id: context.workspace.id, status: 'active',
      created_by: context.user.id, created_at: now, updated_at: now }
    await uniqueWrite(client, `INSERT INTO tool_skill_assets
      (id,workspace_id,asset_type,name,description,parameter_schema,adapter_type,adapter_config,
       status,created_by,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
    [asset.id, asset.workspace_id, asset.asset_type, asset.name, asset.description, asset.parameter_schema,
      asset.adapter_type, asset.adapter_config, asset.status, asset.created_by, now])
  } else {
    const result = await client.query<ToolRow>(
      'SELECT * FROM tool_skill_assets WHERE id=$1 AND workspace_id=$2 FOR UPDATE',
      [params.assetId, context.workspace.id])
    asset = result.rows[0]
    if (!asset) throw new ApiError(404, 'Tool / Skill 资产不存在')
    if (operation === 'update') {
      asset = { ...asset, ...parseFields(input.body, true) }
      requireConfig(asset)
    } else {
      requireConfig(asset, true)
      asset = { ...asset, status: 'disabled' }
    }
    asset.updated_at = new Date()
    await uniqueWrite(client, `UPDATE tool_skill_assets SET name=$1,description=$2,parameter_schema=$3,
      adapter_type=$4,adapter_config=$5,status=$6,updated_at=$7 WHERE id=$8 AND workspace_id=$9`,
    [asset.name, asset.description, asset.parameter_schema, asset.adapter_type, asset.adapter_config,
      asset.status, asset.updated_at, asset.id, context.workspace.id])
  }
  await recordAudit(client, context, input, { ...audit, workspaceId: context.workspace.id,
    targetId: asset.id, outcome: 'success' })
  return { status: operation === 'create' ? 201 : 200, body: project(asset) }
}

async function uniqueWrite(client: SqlClient, sql: string, values: unknown[]) {
  try {
    await client.query(sql, values)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505'
      && 'constraint' in error && error.constraint === 'uq_tool_skill_asset_workspace_type_name') {
      throw new ApiError(409, '资产名称已存在')
    }
    throw error
  }
}

function parseFields(body: unknown, patch: boolean): Partial<ToolFields> {
  if (!isObject(body)) throw invalid()
  const result: Partial<ToolFields> = patch ? {} : {
    description: '', parameter_schema: {}, adapter_type: 'manual', adapter_config: {},
  }
  const allowed = Object.entries(aliases).filter(([key]) => !patch || key !== 'asset_type')
  if (patch && allowed.some(([field, alias]) => field !== alias
    && Object.hasOwn(body, field) && Object.hasOwn(body, alias))) throw invalid()
  if (patch && Object.keys(body).some(key => !allowed.some(([field, alias]) => key === field || key === alias))) {
    throw invalid()
  }
  for (const [field, alias] of allowed) {
    const supplied = Object.hasOwn(body, alias) || Object.hasOwn(body, field)
    if (!supplied) continue
    const value = Object.hasOwn(body, alias) ? body[alias] : body[field]
    if (patch && value === null) continue
    if (field === 'parameter_schema' || field === 'adapter_config') {
      if (!isObject(value)) throw invalid()
      result[field] = value
    } else if (field === 'asset_type' || field === 'adapter_type') {
      const options = field === 'asset_type' ? ['tool', 'skill'] : ['manual', 'http', 'mcp']
      if (typeof value !== 'string' || !options.includes(value)) throw invalid()
      result[field] = value
    } else if (field === 'name' || field === 'description') {
      if (typeof value !== 'string' || Array.from(value).length > (field === 'name' ? 120 : 2000)
        || (field === 'name' && !value.trim())) throw invalid()
      result[field] = field === 'name' ? value.trim() : value
    }
  }
  if (!patch && (!result.name || !result.asset_type)) throw invalid()
  return result
}
function invalid() { return new ApiError(422, '资产请求字段不符合要求') }
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function requireConfig(asset: Pick<ToolFields, 'adapter_type' | 'adapter_config'>, historical = false) {
  try { validateAdapterConfig(asset.adapter_type, asset.adapter_config) } catch (error) {
    if (!(error instanceof AssetConfigurationError)) throw error
    throw new ApiError(historical ? 409 : 422, historical ? HISTORY_ERROR : error.message)
  }
}
function project(asset: ToolRow) {
  return { id: asset.id, assetType: asset.asset_type, name: asset.name, description: asset.description,
    parameterSchema: asset.parameter_schema, adapterType: asset.adapter_type, adapterConfig: asset.adapter_config,
    status: asset.status, createdBy: asset.created_by, createdAt: asset.created_at, updatedAt: asset.updated_at }
}
