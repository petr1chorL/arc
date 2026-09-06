import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { ApiError } from '../identity-workspace/handler.ts'
import { createTransactionBackend, workspaceContext, requireCapability, recordAudit, type SqlClient, type SqlPool } from '../identity-workspace/postgres.ts'
import type { AgentsInput } from './handler.ts'
import { normalizeManifest, parseAgentCreate, parseAgentUpdate, type AgentFields } from './policy.ts'
import { isSafeRegistrationUrl } from '../reference-assets/policy.ts'

type AgentRow = AgentFields & {
  id: string; workspace_id: string; status: string; version: string; pass_rate: number; runs: number
  tools: string[]; skills: string[]; tool_asset_refs: unknown[]; skill_asset_refs: unknown[]; system_prompt: string
  created_at: Date | string; updated_at: Date | string
}
const historyError = () => new ApiError(409, '存在不符合当前安全规则的历史 Agent 或版本，需先完成治理')
type VersionRow = {
  id: string; workspace_id: string; agent_id: string; version: string; snapshot: unknown
  note: string; created_at: Date | string
}

export function createPostgresAgentsBackend(pool: SqlPool) {
  return createTransactionBackend<AgentsInput>(pool, async (client, input) => {
    const { operation, params } = input.route
    const write = !['list', 'get', 'versions'].includes(operation)
    const context = await workspaceContext(client, input, write)
    const audit = {
      action: operation === 'get' ? 'agent.read' : operation === 'versions' ? 'agent.version.list' : `agent.${operation}`,
      targetType: operation === 'list' ? 'workspace' : 'agent',
      targetId: operation === 'list' ? params.workspaceId : params.agentId ?? null,
    }
    const capability = operation === 'publish' ? 'agent.publish' : operation === 'deactivate' ? 'asset.deactivate'
      : write ? 'agent.write' : 'asset.read'
    await requireCapability(client, context, input, capability, audit)
    if (operation === 'list' || operation === 'get') {
      const result = await client.query<AgentRow>(operation === 'list'
        ? 'SELECT * FROM agents WHERE workspace_id=$1 ORDER BY created_at DESC'
        : 'SELECT * FROM agents WHERE workspace_id=$1 AND id=$2',
      operation === 'list' ? [context.workspace.id] : [context.workspace.id, params.agentId])
      if (operation === 'get' && !result.rows.length) throw new ApiError(404, 'Agent 不存在')
      for (const row of result.rows) await requireHistory(client, row)
      return { body: operation === 'list' ? result.rows.map(project) : project(result.rows[0]) }
    }
    if (operation === 'create') {
      const data = parseAgentCreate(input.body)
      if (data.model_provider_id) {
        const provider = (await client.query<{ provider_type: string; base_url: string; default_model: string; status: string }>(
          'SELECT provider_type,base_url,default_model,status FROM model_providers WHERE id=$1 AND workspace_id=$2 FOR SHARE',
          [data.model_provider_id, context.workspace.id])).rows[0]
        if (!provider) throw new ApiError(404, '模型 Provider 不存在')
        if (provider.status === 'disabled') throw new ApiError(422, '模型 Provider 已停用')
        data.model_provider = provider.provider_type
        data.model_base_url = provider.base_url
        data.model = provider.default_model
      }
      const now = new Date()
      const row: AgentRow = { ...data, id: randomUUID(), workspace_id: context.workspace.id,
        status: '调试中', version: 'v0.1.0', pass_rate: 0, runs: 0, tools: [], skills: [],
        tool_asset_refs: [], skill_asset_refs: [], system_prompt: '', created_at: now, updated_at: now }
      await requireHistory(client, row)
      const columns = Object.keys(row) as (keyof AgentRow)[]
      const jsonFields = new Set(['tools', 'skills', 'tool_asset_refs', 'skill_asset_refs', 'runtime_manifest'])
      await client.query(`INSERT INTO agents (${columns.join(',')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(',')})`,
        columns.map(key => jsonFields.has(key) ? JSON.stringify(row[key]) : row[key]))
      await recordAudit(client, context, input, { ...audit, workspaceId: context.workspace.id, targetId: row.id, outcome: 'success' })
      return { status: 201, body: project(row) }
    }
    if (operation === 'versions') {
      const agent = await client.query('SELECT id FROM agents WHERE workspace_id=$1 AND id=$2',
        [context.workspace.id, params.agentId])
      if (!agent.rows.length) throw new ApiError(404, 'Agent 不存在')
      const versions = await client.query<VersionRow>(
        'SELECT * FROM agent_versions WHERE workspace_id=$1 AND agent_id=$2 ORDER BY created_at DESC',
        [context.workspace.id, params.agentId])
      for (const version of versions.rows) await requireSnapshot(client, version)
      return { body: versions.rows.map(version => ({ id: version.id,
        version: version.version, snapshot: version.snapshot, note: version.note, createdAt: new Date(version.created_at).toISOString() })) }
    }
    if (operation === 'activate' || operation === 'deactivate') {
      const row = (await client.query<AgentRow>('SELECT * FROM agents WHERE workspace_id=$1 AND id=$2 FOR UPDATE',
        [context.workspace.id, params.agentId])).rows[0]
      if (!row) throw new ApiError(404, 'Agent 不存在')
      await requireHistory(client, row)
      if (operation === 'deactivate') row.status = '已停用'
      else {
        const versions = await client.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM agent_versions WHERE workspace_id=$1 AND agent_id=$2',
          [context.workspace.id, row.id])
        row.status = versions.rows[0].n > 0 ? '在线' : '调试中'
      }
      row.updated_at = new Date()
      await client.query('UPDATE agents SET status=$1,updated_at=$2 WHERE workspace_id=$3 AND id=$4',
        [row.status, row.updated_at, context.workspace.id, row.id])
      await recordAudit(client, context, input, { ...audit, workspaceId: context.workspace.id, targetId: row.id, outcome: 'success' })
      return { body: project(row) }
    }
    if (operation === 'update') {
      const updates = parseAgentUpdate(input.body)
      let row = (await client.query<AgentRow>('SELECT * FROM agents WHERE workspace_id=$1 AND id=$2 FOR UPDATE',
        [context.workspace.id, params.agentId])).rows[0]
      if (!row) throw new ApiError(404, 'Agent 不存在')
      if (['已停用', '宸插仠鐢?'].includes(row.status)) throw new ApiError(409, '已停用 Agent 不允许编辑')
      if (updates.model_provider_id) {
        const provider = (await client.query<{ provider_type: string; base_url: string; default_model: string; status: string }>(
          'SELECT provider_type,base_url,default_model,status FROM model_providers WHERE id=$1 AND workspace_id=$2 FOR SHARE',
          [updates.model_provider_id, context.workspace.id])).rows[0]
        if (!provider) throw new ApiError(404, '模型 Provider 不存在')
        if (provider.status === 'disabled') throw new ApiError(422, '模型 Provider 已停用')
        updates.model_provider = provider.provider_type
        updates.model_base_url = provider.base_url
        updates.model = provider.default_model
      }
      row = { ...row, ...updates }
      await bindToolsSkills(client, row)
      await requireHistory(client, row)
      row.updated_at = new Date()
      const fields = ['name', 'role', 'owner', 'model', 'model_provider_id', 'model_provider', 'model_base_url',
        'temperature', 'max_output_tokens', 'system_prompt', 'tools', 'skills', 'tool_asset_refs', 'skill_asset_refs',
        'runtime_manifest', 'updated_at'] as const
      const jsonFields = new Set(['tools', 'skills', 'tool_asset_refs', 'skill_asset_refs', 'runtime_manifest'])
      await client.query(`UPDATE agents SET ${fields.map((field, index) => `${field}=$${index + 1}`).join(',')}
        WHERE workspace_id=$17 AND id=$18`,
      [...fields.map(field => jsonFields.has(field) ? JSON.stringify(row[field]) : row[field]), context.workspace.id, row.id])
      await recordAudit(client, context, input, { ...audit, workspaceId: context.workspace.id, targetId: row.id, outcome: 'success' })
      return { body: project(row) }
    }
    if (operation === 'publish') {
      const body = input.body
      if (body !== null && (typeof body !== 'object' || Array.isArray(body))) throw new ApiError(422, 'Agent 请求字段不符合要求')
      const note = body && Object.hasOwn(body, 'note') ? (body as Record<string, unknown>).note : ''
      if (typeof note !== 'string' || Array.from(note).length > 500) throw new ApiError(422, 'Agent 请求字段不符合要求')
      const row = (await client.query<AgentRow>('SELECT * FROM agents WHERE workspace_id=$1 AND id=$2 FOR UPDATE',
        [context.workspace.id, params.agentId])).rows[0]
      if (!row) throw new ApiError(404, 'Agent 不存在')
      if (['已停用', '宸插仠鐢?'].includes(row.status)) throw new ApiError(409, '已停用 Agent 不允许发布')
      await requireHistory(client, row)
      let provider: { provider_type: string; base_url: string; default_model: string; secret_ref: string; status: string } | undefined
      if (row.model_provider_id) {
        provider = (await client.query<NonNullable<typeof provider>>(
          'SELECT provider_type,base_url,default_model,secret_ref,status FROM model_providers WHERE id=$1 AND workspace_id=$2 FOR SHARE',
          [row.model_provider_id, context.workspace.id])).rows[0]
        if (!provider) throw new ApiError(404, '模型 Provider 不存在')
        if (provider.status === 'disabled') throw new ApiError(422, '模型 Provider 已停用')
      }
      await bindToolsSkills(client, row)
      const count = (await client.query<{ n: number }>('SELECT count(*)::int AS n FROM agent_versions WHERE workspace_id=$1 AND agent_id=$2',
        [context.workspace.id, row.id])).rows[0].n
      const version = count === 0 ? 'v1.0.0' : `v1.${count}.0`
      if ((await client.query('SELECT id FROM agent_versions WHERE workspace_id=$1 AND agent_id=$2 AND version=$3',
        [context.workspace.id, row.id, version])).rows.length) throw new ApiError(409, 'Agent 版本号冲突，需先完成治理')
      const snapshot: Record<string, unknown> = project(row)
      if (provider) {
        snapshot.modelProvider = provider.provider_type
        snapshot.modelBaseUrl = provider.base_url
        snapshot.model = provider.default_model
        const label = provider.secret_ref.trim()
        snapshot.modelSecretRef = /^[A-Z_][A-Z0-9_]*$/.test(label) ? label : ''
      }
      const now = new Date()
      const published: VersionRow = { id: randomUUID(), workspace_id: context.workspace.id, agent_id: row.id,
        version, snapshot, note: note.trim(), created_at: now }
      await requireSnapshot(client, published)
      await client.query(`INSERT INTO agent_versions (id,workspace_id,agent_id,version,snapshot,note,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`, [published.id, published.workspace_id, row.id, version, JSON.stringify(snapshot), published.note, now])
      await client.query(`UPDATE agents SET version=$1,status='在线',updated_at=$2,tool_asset_refs=$3,skill_asset_refs=$4
        WHERE workspace_id=$5 AND id=$6`, [version, now, JSON.stringify(row.tool_asset_refs), JSON.stringify(row.skill_asset_refs), context.workspace.id, row.id])
      await recordAudit(client, context, input, { ...audit, workspaceId: context.workspace.id, targetId: row.id, outcome: 'success' })
      return { status: 201, body: { id: published.id, version, snapshot, note: published.note, createdAt: now.toISOString() } }
    }
    throw new ApiError(404, 'Not Found')
  })
}

async function bindToolsSkills(client: SqlClient, row: AgentRow): Promise<void> {
  for (const [kind, names, field] of [['tool', row.tools, 'tool_asset_refs'], ['skill', row.skills, 'skill_asset_refs']] as const) {
    if (!Array.isArray(names) || names.some(name => typeof name !== 'string')) throw historyError()
    // A fixed type order and sorted row locks protect dependencies without reordering the user's list.
    const assets = await client.query<{ id: string; asset_type: string; name: string; status: string; adapter_type: string }>(
      'SELECT id,asset_type,name,status,adapter_type FROM tool_skill_assets WHERE workspace_id=$1 AND asset_type=$2 AND name=ANY($3) ORDER BY id FOR SHARE',
      [row.workspace_id, kind, names])
    row[field] = names.map(name => {
      const asset = assets.rows.find(candidate => candidate.name === name && candidate.status === 'active')
      if (!asset) throw new ApiError(422, `未授权或不可用的 ${kind === 'tool' ? 'Tool' : 'Skill'}：${name}`)
      return { assetId: asset.id, assetType: asset.asset_type, assetName: asset.name, status: asset.status, adapterType: asset.adapter_type }
    })
  }
}

async function requireHistory(client: SqlClient, row: Pick<AgentRow,
  'workspace_id' | 'model_base_url' | 'runtime_manifest' | 'model_provider_id' | 'tool_asset_refs' | 'skill_asset_refs'>): Promise<void> {
  try {
    if (typeof row.model_base_url !== 'string' || row.model_base_url.trim() !== row.model_base_url
      || (row.model_base_url && !isSafeRegistrationUrl(row.model_base_url))
      || !isDeepStrictEqual(normalizeManifest(row.runtime_manifest), row.runtime_manifest)) throw historyError()
  } catch { throw historyError() }
  if (row.model_provider_id !== null) {
    if (typeof row.model_provider_id !== 'string' || !row.model_provider_id) throw historyError()
    const provider = await client.query('SELECT id FROM model_providers WHERE id=$1 AND workspace_id=$2',
      [row.model_provider_id, row.workspace_id])
    if (!provider.rows.length) throw historyError()
  }
  for (const [kind, refs] of [['tool', row.tool_asset_refs], ['skill', row.skill_asset_refs]] as const) {
    if (!Array.isArray(refs)) throw historyError()
    for (const raw of refs) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw historyError()
      const ref = raw as Record<string, unknown>
      if (typeof ref.assetId !== 'string' || !ref.assetId || ref.assetType !== kind
        || ['assetName', 'status', 'adapterType'].some(field => typeof ref[field] !== 'string')) throw historyError()
      const asset = await client.query('SELECT id FROM tool_skill_assets WHERE id=$1 AND workspace_id=$2 AND asset_type=$3',
        [ref.assetId, row.workspace_id, kind])
      if (!asset.rows.length) throw historyError()
    }
  }
}

async function requireSnapshot(client: SqlClient, version: VersionRow): Promise<void> {
  const raw = version.snapshot
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw historyError()
  const snapshot = raw as Record<string, unknown>
  const secret = Object.hasOwn(snapshot, 'modelSecretRef') ? snapshot.modelSecretRef : ''
  if (typeof secret !== 'string' || secret.trim() !== secret || (secret && !/^[A-Z_][A-Z0-9_]*$/.test(secret))) throw historyError()
  const field = (name: string, fallback: unknown) => Object.hasOwn(snapshot, name) ? snapshot[name] : fallback
  // Casts only connect the stored JSON shape to the shared runtime validator; values are not normalized.
  await requireHistory(client, { workspace_id: version.workspace_id,
    model_base_url: field('modelBaseUrl', '') as string,
    runtime_manifest: field('runtimeManifest', {}) as Record<string, unknown>,
    model_provider_id: field('modelProviderId', null) as string | null,
    tool_asset_refs: field('toolAssetRefs', []) as unknown[], skill_asset_refs: field('skillAssetRefs', []) as unknown[] })
}

function projectReference(raw: unknown) {
  const ref = raw as Record<string, unknown>
  return { assetId: ref.assetId, assetType: ref.assetType, assetName: ref.assetName,
    status: ref.status, adapterType: ref.adapterType }
}

function project(row: AgentRow) {
  return { id: row.id, name: row.name, role: row.role, owner: row.owner, model: row.model,
    modelProviderId: row.model_provider_id, modelProvider: row.model_provider, modelBaseUrl: row.model_base_url,
    temperature: row.temperature, maxOutputTokens: row.max_output_tokens, status: row.status, version: row.version,
    passRate: row.pass_rate, runs: row.runs, tools: row.tools, skills: row.skills,
    toolAssetRefs: row.tool_asset_refs.map(projectReference), skillAssetRefs: row.skill_asset_refs.map(projectReference), systemPrompt: row.system_prompt,
    runtimeManifest: row.runtime_manifest, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() }
}
