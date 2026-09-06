import { ApiError, type BackendResult } from '../identity-workspace/handler.ts'
import { requireCapability, type SqlClient, type WorkspaceContext } from '../identity-workspace/postgres.ts'
import type { ReferenceAssetsInput } from './handler.ts'

type Agent = { id: string; name: string; status: string; version: string; model_provider_id: string | null
  tools: unknown; skills: unknown; tool_asset_refs: unknown; skill_asset_refs: unknown }
type Version = { id: string; agent_id: string; version: string; snapshot: unknown }
type Asset = { id: string; name: string; asset_type?: string }
const HISTORY_ERROR = '存在不符合当前安全规则的历史资产或记录，需先完成治理'

export async function readAssetImpact(
  client: SqlClient, context: WorkspaceContext, input: ReferenceAssetsInput,
): Promise<BackendResult> {
  const provider = input.route.kind === 'provider'
  const targetType = provider ? 'model_provider' : 'tool_skill_asset'
  await requireCapability(client, context, input, 'asset.read', {
    action: `${targetType}.impact`, targetType, targetId: input.route.params.assetId ?? null,
  })
  const assetResult = await client.query<Asset>(provider
    ? 'SELECT id,name FROM model_providers WHERE id=$1 AND workspace_id=$2'
    : 'SELECT id,name,asset_type FROM tool_skill_assets WHERE id=$1 AND workspace_id=$2',
  [input.route.params.assetId, context.workspace.id])
  const asset = assetResult.rows[0]
  if (!asset) throw new ApiError(404, provider ? '模型 Provider 不存在' : 'Tool / Skill 资产不存在')
  if (!provider && !['tool', 'skill'].includes(asset.asset_type ?? '')) throw historical()
  const agents = (await client.query<Agent>(`SELECT id,name,status,version,model_provider_id,
    tools,skills,tool_asset_refs,skill_asset_refs FROM agents WHERE workspace_id=$1 ORDER BY updated_at DESC`,
  [context.workspace.id])).rows
  const versions = (await client.query<Version>(`SELECT id,agent_id,version,snapshot FROM agent_versions
    WHERE workspace_id=$1 ORDER BY created_at DESC`, [context.workspace.id])).rows
  const tool = asset.asset_type === 'tool'
  const drafts = agents.filter(agent => provider ? agent.model_provider_id === asset.id
    : matches(tool ? agent.tool_asset_refs : agent.skill_asset_refs, tool ? agent.tools : agent.skills, asset))
  const published = versions.flatMap(version => {
    if (!isObject(version.snapshot)) throw historical()
    const snapshot = version.snapshot
    const match = provider ? snapshot.modelProviderId === asset.id
      : matches(snapshot[tool ? 'toolAssetRefs' : 'skillAssetRefs'], snapshot[tool ? 'tools' : 'skills'], asset)
    if (!match) return []
    // A historical version may only reveal an Agent belonging to this same workspace.
    if (!agents.some(agent => agent.id === version.agent_id)
      || (snapshot.id !== undefined && snapshot.id !== version.agent_id)) throw historical()
    if (snapshot.name !== undefined && typeof snapshot.name !== 'string') throw historical()
    const secret = Object.hasOwn(snapshot, 'modelSecretRef') ? snapshot.modelSecretRef : ''
    if (provider && (typeof secret !== 'string' || secret.trim() !== secret
      || (secret !== '' && !/^[A-Z_][A-Z0-9_]*$/.test(secret)))) {
      throw historical()
    }
    return [{ agentId: version.agent_id, agentName: snapshot.name ?? '', versionId: version.id,
      version: version.version, ...(provider ? { modelSecretRef: secret } : {}) }]
  })
  return { body: {
    ...(provider ? { providerId: asset.id } : { assetId: asset.id, assetType: asset.asset_type, assetName: asset.name }),
    totals: { draftAgents: drafts.length, publishedVersions: published.length },
    draftAgents: drafts.map(agent => ({ agentId: agent.id, agentName: agent.name, status: agent.status, version: agent.version })),
    publishedVersions: published,
  } }
}

function matches(refs: unknown, names: unknown, asset: Asset): boolean {
  const references = refs ?? [], legacyNames = names ?? []
  if (!Array.isArray(references) || !Array.isArray(legacyNames)) throw historical()
  return references.some(ref => isObject(ref) && ref.assetId === asset.id) || legacyNames.includes(asset.name)
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function historical() { return new ApiError(409, HISTORY_ERROR) }
