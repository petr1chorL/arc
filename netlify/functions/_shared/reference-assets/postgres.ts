import { randomUUID } from 'node:crypto'
import { ApiError, type BackendResult } from '../identity-workspace/handler.ts'
import {
  createTransactionBackend, workspaceContext, requireCapability, recordAudit,
  type SqlClient, type SqlPool,
} from '../identity-workspace/postgres.ts'
import type { ReferenceAssetsInput } from './handler.ts'
import { isSafeRegistrationUrl } from './policy.ts'
import { dispatchToolSkill } from './tool-skill-postgres.ts'
import { readAssetImpact } from './impact-postgres.ts'
import { readAssetHistory } from './history-postgres.ts'
import { checkProviderConfiguration, migrateProviderDrafts, type ProviderCompatibilityOptions } from './provider-compat-postgres.ts'
import { submitToolTest } from './tool-test-postgres.ts'

type ProviderFields = {
  name: string; provider_type: string; base_url: string; default_model: string; secret_ref: string
}
type ProviderRow = ProviderFields & {
  id: string; workspace_id: string; status: string; created_by: string
  created_at: Date | string; updated_at: Date | string
}
const HISTORY_ERROR = '存在不符合当前安全规则的历史资产或记录，需先完成治理'
const fields = [
  ['name', 'name', 120], ['provider_type', 'providerType', 80], ['base_url', 'baseUrl', 500],
  ['default_model', 'defaultModel', 120], ['secret_ref', 'secretRef', 160],
] as const

export function createPostgresReferenceAssetsBackend(pool: SqlPool, options: ProviderCompatibilityOptions = {}) {
  return createTransactionBackend<ReferenceAssetsInput>(pool, (client, input) => dispatch(client, input, options))
}

async function dispatch(client: SqlClient, input: ReferenceAssetsInput, options: ProviderCompatibilityOptions): Promise<BackendResult> {
  const { operation, kind, params } = input.route
  const write = ['create', 'update', 'deactivate', 'test', 'migrate-drafts', 'test-invocations'].includes(operation)
  const context = await workspaceContext(client, input, write)
  if (operation === 'impact') return readAssetImpact(client, context, input)
  if (operation === 'audit' || operation === 'invocations') return readAssetHistory(client, context, input)
  if (kind === 'asset' && operation === 'test-invocations') return submitToolTest(client, context, input)
  if (kind === 'asset') return dispatchToolSkill(client, context, input)
  if (operation === 'test') return checkProviderConfiguration(client, context, input, options)
  if (operation === 'migrate-drafts') return migrateProviderDrafts(client, context, input)
  // This module remains internal until all approved routes have implementation and evidence.
  if (!['list', 'create', 'update', 'deactivate'].includes(operation)) {
    throw new ApiError(501, '该资产接口尚未完成迁移')
  }
  const audit = { action: `model_provider.${operation}`,
    targetType: operation === 'list' ? 'workspace' : 'model_provider',
    targetId: operation === 'list' ? context.workspace.id : params.assetId ?? null }
  await requireCapability(client, context, input, write ? 'agent.write' : 'asset.read', audit)
  if (operation === 'list') {
    const result = await client.query<ProviderRow>(
      'SELECT * FROM model_providers WHERE workspace_id=$1 ORDER BY created_at DESC', [context.workspace.id])
    result.rows.forEach(requireHistoricalProvider)
    return { body: result.rows.map(project) }
  }
  let provider: ProviderRow
  if (operation === 'create') {
    const data = parseFields(input.body, false) as ProviderFields
    requireSecret(data.secret_ref)
    requireUrl(data.base_url)
    const now = new Date()
    provider = { ...data, id: randomUUID(), workspace_id: context.workspace.id, status: 'draft',
      created_by: context.user.id, created_at: now, updated_at: now }
    await uniqueWrite(client, `INSERT INTO model_providers
      (id,workspace_id,name,provider_type,base_url,default_model,secret_ref,status,created_by,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
    [provider.id, provider.workspace_id, provider.name, provider.provider_type, provider.base_url,
      provider.default_model, provider.secret_ref, provider.status, provider.created_by, now])
  } else {
    const result = await client.query<ProviderRow>(
      'SELECT * FROM model_providers WHERE id=$1 AND workspace_id=$2 FOR UPDATE',
      [params.assetId, context.workspace.id])
    provider = result.rows[0]
    if (!provider) throw new ApiError(404, '模型 Provider 不存在')
    if (operation === 'update') {
      const updates = parseFields(input.body, true)
      requireUrl(updates.base_url ?? provider.base_url)
      if (updates.secret_ref !== undefined) requireSecret(updates.secret_ref)
      provider = { ...provider, ...updates }
    } else {
      provider = { ...provider, status: 'disabled' }
    }
    requireHistoricalProvider(provider)
    provider.updated_at = new Date()
    await uniqueWrite(client, `UPDATE model_providers SET name=$1,provider_type=$2,base_url=$3,
      default_model=$4,secret_ref=$5,status=$6,updated_at=$7 WHERE id=$8 AND workspace_id=$9`,
    [provider.name, provider.provider_type, provider.base_url, provider.default_model, provider.secret_ref,
      provider.status, provider.updated_at, provider.id, context.workspace.id])
  }
  await recordAudit(client, context, input, { ...audit, workspaceId: context.workspace.id,
    targetId: provider.id, outcome: 'success' })
  return { status: operation === 'create' ? 201 : 200, body: project(provider) }
}

async function uniqueWrite(client: SqlClient, sql: string, values: unknown[]) {
  try {
    await client.query(sql, values)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505'
      && 'constraint' in error && error.constraint === 'uq_model_provider_workspace_name') {
      throw new ApiError(409, '模型 Provider 名称已存在')
    }
    throw error
  }
}

function parseFields(body: unknown, patch: boolean): Partial<ProviderFields> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(422, '资产请求字段不符合要求')
  }
  const input = body as Record<string, unknown>
  const result: Partial<ProviderFields> = {}
  for (const [field, alias, maximum] of fields) {
    const supplied = Object.hasOwn(input, alias) || Object.hasOwn(input, field)
    if (!supplied && patch) continue
    const value = Object.hasOwn(input, alias) ? input[alias] : input[field]
    if (patch && value === null) throw new ApiError(422, 'Provider 字段不能为 null')
    if (!supplied && field === 'provider_type') { result[field] = 'openai-compatible'; continue }
    if (typeof value !== 'string' || !value.trim() || Array.from(value).length > maximum) {
      throw new ApiError(422, '资产请求字段不符合要求')
    }
    if (field === 'provider_type' && !['openai-compatible', 'anthropic-compatible'].includes(value)) {
      throw new ApiError(422, '资产请求字段不符合要求')
    }
    result[field] = value.trim()
  }
  return result
}

function requireUrl(value: string) {
  if (!isSafeRegistrationUrl(value)) throw new ApiError(422, 'Provider 地址不符合安全登记规则')
}
function requireSecret(value: string) {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(value)) throw new ApiError(422, 'Secret Ref 只能填写后端环境变量名')
}
function requireHistoricalProvider(provider: ProviderRow) {
  if (!isSafeRegistrationUrl(provider.base_url) || provider.secret_ref.trim() !== provider.secret_ref
    || !/^[A-Z_][A-Z0-9_]*$/.test(provider.secret_ref)) {
    throw new ApiError(409, HISTORY_ERROR)
  }
}
function project(provider: ProviderRow) {
  return { id: provider.id, name: provider.name, providerType: provider.provider_type,
    baseUrl: provider.base_url, defaultModel: provider.default_model, secretRef: provider.secret_ref,
    status: provider.status, createdBy: provider.created_by,
    createdAt: provider.created_at, updatedAt: provider.updated_at }
}
