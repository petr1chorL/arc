import { ApiError, type BackendResult } from '../identity-workspace/handler.ts'
import { recordAudit, requireCapability, type SqlClient, type WorkspaceContext } from '../identity-workspace/postgres.ts'
import type { ReferenceAssetsInput } from './handler.ts'
import { isSafeRegistrationUrl } from './policy.ts'
import { strip } from '../rubrics/policy.ts'

export type ProviderCompatibilityOptions = {
  secretPresence?: (binding: { workspaceId: string; providerId: string; secretRef: string; baseUrl: string }) => boolean | Promise<boolean>
}
type Provider = { id: string; workspace_id: string; secret_ref: string; base_url: string;
  status: string; provider_type: string; default_model: string }

/** Checks configuration only. No secret value or network transport crosses this port. */
export async function checkProviderConfiguration(client: SqlClient, context: WorkspaceContext,
  input: ReferenceAssetsInput, options: ProviderCompatibilityOptions): Promise<BackendResult> {
  await requireCapability(client, context, input, 'agent.write', {
    action: 'model_provider.test', targetType: 'model_provider', targetId: input.route.params.assetId ?? null,
  })
  const provider = (await client.query<Provider>(
    'SELECT * FROM model_providers WHERE workspace_id=$1 AND id=$2 FOR SHARE',
    [context.workspace.id, input.route.params.assetId])).rows[0]
  if (!provider) throw new ApiError(404, '模型 Provider 不存在')
  if (!isSafeRegistrationUrl(provider.base_url) || !/^[A-Z_][A-Z0-9_]*$/.test(provider.secret_ref)) {
    throw new ApiError(409, '存在不符合当前安全规则的历史资产或记录，需先完成治理')
  }
  const present = await options.secretPresence?.({ workspaceId: context.workspace.id, providerId: provider.id,
    secretRef: provider.secret_ref, baseUrl: provider.base_url }) === true
  return { body: { providerId: provider.id, status: present ? 'ready' : 'missing_secret',
    message: present ? '模型 Provider 配置完整，密钥引用已在后端环境变量中解析'
      : `密钥引用 ${provider.secret_ref} 未在后端环境变量中配置` } }
}

/** Moves only editable Agent rows; frozen Agent/Workflow versions retain their references. */
export async function migrateProviderDrafts(client: SqlClient, context: WorkspaceContext,
  input: ReferenceAssetsInput): Promise<BackendResult> {
  const audit = { action: 'model_provider.migrate_drafts', targetType: 'model_provider', targetId: input.route.params.assetId ?? null }
  await requireCapability(client, context, input, 'agent.write', audit)
  const payload = migrationPayload(input.body)
  // Share locks freeze Provider configuration without inverting Agent publish/update locks.
  const providers = (await client.query<Provider>(
    'SELECT * FROM model_providers WHERE workspace_id=$1 AND id=ANY($2::text[]) ORDER BY id FOR SHARE',
    [context.workspace.id, [input.route.params.assetId, payload.targetProviderId]])).rows
  const source = providers.find(provider => provider.id === input.route.params.assetId)
  if (!source) throw new ApiError(404, '模型 Provider 不存在')
  if (source.id === payload.targetProviderId) throw new ApiError(422, '目标 Provider 不能与源 Provider 相同')
  const target = providers.find(provider => provider.id === payload.targetProviderId)
  if (!target) throw new ApiError(404, '模型 Provider 不存在')
  if (target.status === 'disabled') throw new ApiError(422, '模型 Provider 已停用')
  if (!isSafeRegistrationUrl(target.base_url) || !/^[A-Z_][A-Z0-9_]*$/.test(target.secret_ref)) {
    throw new ApiError(409, '存在不符合当前安全规则的历史资产或记录，需先完成治理')
  }
  const agents = (await client.query<{ id: string; name: string; model: string }>(
    'SELECT id,name,model FROM agents WHERE workspace_id=$1 AND model_provider_id=$2 ORDER BY updated_at DESC,id FOR UPDATE',
    [context.workspace.id, source.id])).rows
  await client.query(`UPDATE agents SET model_provider_id=$1,model_provider=$2,model_base_url=$3,model=$4,updated_at=$5
    WHERE workspace_id=$6 AND id=ANY($7::text[])`,
  [target.id, target.provider_type, target.base_url, target.default_model, new Date(), context.workspace.id, agents.map(agent => agent.id)])
  await recordAudit(client, context, input, { ...audit, workspaceId: context.workspace.id, outcome: 'success',
    metadata: { sourceProviderId: source.id, targetProviderId: target.id, reason: payload.reason,
      migratedAgentIds: agents.map(agent => agent.id) } })
  return { body: { sourceProviderId: source.id, targetProviderId: target.id, migratedCount: agents.length,
    migratedAgents: agents.map(agent => ({ agentId: agent.id, agentName: agent.name,
      previousModel: agent.model, nextModel: target.default_model })) } }
}

function migrationPayload(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(422, '迁移请求字段不符合要求')
  const value = body as Record<string, unknown>
  if (Object.keys(value).some(key => !['targetProviderId', 'target_provider_id', 'reason'].includes(key))
    || (Object.hasOwn(value, 'targetProviderId') && Object.hasOwn(value, 'target_provider_id'))) {
    throw new ApiError(422, '迁移请求字段不符合要求')
  }
  const target = value.targetProviderId ?? value.target_provider_id
  if (typeof target !== 'string' || !strip(target) || Array.from(target).length > 36
    || typeof value.reason !== 'string' || !strip(value.reason) || Array.from(value.reason).length > 1000) {
    throw new ApiError(422, '迁移请求字段不符合要求')
  }
  return { targetProviderId: strip(target), reason: strip(value.reason) }
}
