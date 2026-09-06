import { ApiError, type BackendResult } from '../identity-workspace/handler.ts'
import { randomUUID } from 'node:crypto'
import { createTransactionBackend, workspaceContext, requireCapability, recordAudit, type SqlPool, type SqlClient, type WorkspaceContext } from '../identity-workspace/postgres.ts'
import type { RubricsInput } from './handler.ts'
import { parseRubricWrite, strip, type RubricFields } from './policy.ts'
import { DEFAULT_RUBRICS } from './defaults.ts'
import { casefold } from './casefold.ts'

type RubricRow = Omit<RubricFields, 'dimensions'> & {
  id: string; workspace_id: string; dimensions: unknown; status: string; version: string; sort_order: number
}
type VersionRow = { id: string; version: string; snapshot: unknown; created_at: Date | string }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const historyError = () => new ApiError(409, '历史评分量规结构不符合要求，需先完成治理')

/** Isolated governance backend; not registered on any production Function path. */
export function createPostgresRubricsBackend(pool: SqlPool) {
  return createTransactionBackend<RubricsInput>(pool, async (client, input) => {
    const { operation } = input.route
    const context = await workspaceContext(client, input, !['list', 'versions'].includes(operation))
    const audit = { action: `evaluation.rubric.${operation === 'versions' ? 'version.list' : operation}`, targetType: operation === 'list' ? 'workspace' : 'rubric',
      targetId: operation === 'list' ? context.workspace.id : input.route.params.rubricId ?? null }
    const capability = ['list', 'versions'].includes(operation) ? 'asset.read'
      : operation === 'publish' ? 'rubric.publish' : operation === 'deactivate' ? 'asset.deactivate' : 'rubric.write'
    await requireCapability(client, context, input, capability, audit)
    if (operation === 'list') {
      await ensureDefaults(client, context.workspace.id)
      const rows = await client.query<RubricRow>('SELECT * FROM rubrics WHERE workspace_id=$1 ORDER BY sort_order ASC,created_at ASC', [context.workspace.id])
      return { body: rows.rows.map(projectRubric) }
    }
    if (operation === 'versions') {
      await findRubric(client, context.workspace.id, input.route.params.rubricId!, false)
      const rows = await client.query<VersionRow>('SELECT * FROM rubric_versions WHERE workspace_id=$1 AND rubric_id=$2 ORDER BY created_at DESC',
        [context.workspace.id, input.route.params.rubricId])
      return { body: rows.rows.map(projectVersion) }
    }
    if (operation !== 'create') return mutateRubric(client, input, context)
    const data = parseRubricWrite(input.body)
    // Serialize first creation with default initialization, and allocate sort order in the same scope.
    await client.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [context.workspace.id])
    if (data.model_provider_id !== null) await requireProvider(client, context.workspace.id, data.model_provider_id)
    const sortOrder = (await client.query<{ n: number }>('SELECT COALESCE(max(sort_order),0)::int AS n FROM rubrics WHERE workspace_id=$1',
      [context.workspace.id])).rows[0].n + 1
    const row: RubricRow = { ...data, id: randomUUID(), workspace_id: context.workspace.id, sort_order: sortOrder,
      status: 'draft', version: 'v0.1.0', dimensions: storedDimensions(data) }
    await insertRubric(client, row)
    await recordAudit(client, context, input, { ...audit, workspaceId: context.workspace.id, targetId: row.id, outcome: 'success' })
    return { status: 201, body: projectRubric(row) }
  })
}

function storedDimensions(data: RubricFields) {
  return data.dimensions.map(item => ({ name: item.name, weight: item.weight,
    id: item.id ?? randomUUID(), ...(item.criteria === null ? {} : { criteria: item.criteria }) }))
}

async function mutateRubric(client: SqlClient, input: RubricsInput, context: WorkspaceContext): Promise<BackendResult> {
  const { operation, params } = input.route
  const data = operation === 'update' ? parseRubricWrite(input.body) : null
  const row = await findRubric(client, context.workspace.id, params.rubricId!, true)
  let published: VersionRow | null = null
  const now = new Date()
  if (operation === 'update') {
    if (data!.model_provider_id !== null) await requireProvider(client, context.workspace.id, data!.model_provider_id)
    if (row.status === 'disabled') throw new ApiError(409, '已停用评分量规不允许编辑')
    Object.assign(row, data, { dimensions: storedDimensions(data!) })
  } else if (operation === 'deactivate') {
    row.status = 'disabled'
  } else if (operation === 'publish') {
    if (row.status === 'disabled') throw new ApiError(409, '已停用评分量规不允许发布')
    await validateLlmPublication(client, row)
    const count = (await client.query<{ n: number }>('SELECT count(*)::int AS n FROM rubric_versions WHERE workspace_id=$1 AND rubric_id=$2',
      [context.workspace.id, row.id])).rows[0].n
    const version = `v1.${count}.0`
    if ((await client.query('SELECT id FROM rubric_versions WHERE workspace_id=$1 AND rubric_id=$2 AND version=$3',
      [context.workspace.id, row.id, version])).rows.length) throw new ApiError(409, '评分量规版本号冲突，需先完成治理')
    row.version = version
    row.status = 'active'
    published = { id: randomUUID(), version, snapshot: rubricSnapshot(row), created_at: now }
    await client.query('INSERT INTO rubric_versions (id,workspace_id,rubric_id,version,snapshot,created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [published.id, context.workspace.id, row.id, version, JSON.stringify(published.snapshot), now])
  } else {
    throw new ApiError(404, 'Not Found')
  }
  const body = projectRubric(row)
  await client.query(`UPDATE rubrics SET name=$1,artifact=$2,dimensions=$3,gate=$4,pass_score=$5,judge_type=$6,judge_model=$7,
    model_provider_id=$8,version=$9,status=$10,updated_at=$11 WHERE workspace_id=$12 AND id=$13`,
  [row.name, row.artifact, JSON.stringify(row.dimensions), row.gate, row.pass_score, row.judge_type, row.judge_model,
    row.model_provider_id, row.version, row.status, now, context.workspace.id, row.id])
  await recordAudit(client, context, input, { workspaceId: context.workspace.id, action: `evaluation.rubric.${operation}`,
    targetType: 'rubric', targetId: row.id, outcome: 'success' })
  return published ? { status: 201, body: projectVersion(published) } : { body }
}

async function validateLlmPublication(client: SqlClient, row: RubricRow): Promise<void> {
  if (row.judge_type !== 'llm') return
  if (typeof row.judge_model !== 'string' || (row.model_provider_id !== null && typeof row.model_provider_id !== 'string')) throw historyError()
  if (!strip(row.judge_model)) throw new ApiError(422, 'LLM 评分模板必须配置模型')
  if (!row.model_provider_id || !strip(row.model_provider_id)) throw new ApiError(422, 'LLM 评分模板必须配置模型 Provider')
  await requireProvider(client, row.workspace_id, strip(row.model_provider_id))
  if (!Array.isArray(row.dimensions) || !row.dimensions.length) throw new ApiError(422, 'LLM 评分模板必须配置评分维度')
  const ids: string[] = [], names: string[] = []
  for (const item of row.dimensions) {
    if (!object(item)) throw new ApiError(422, '评分维度格式无效')
    if (typeof item.id !== 'string' || !strip(item.id) || typeof item.criteria !== 'string' || !strip(item.criteria)) {
      throw new ApiError(422, 'LLM 评分模板的每个维度必须配置 ID 和评分标准')
    }
    if (typeof item.name !== 'string' || !strip(item.name)) throw new ApiError(422, '维度名称不能为空')
    ids.push(casefold(strip(item.id)))
    names.push(casefold(strip(item.name)))
  }
  if (new Set(ids).size !== ids.length) throw new ApiError(422, '维度 ID 必须唯一')
  if (new Set(names).size !== names.length) throw new ApiError(422, '维度名称必须唯一')
}

function rubricSnapshot(row: RubricRow) {
  const projected = projectRubric(row)
  return { id: projected.id, name: projected.name, artifact: projected.artifact, dimensions: projected.dimensions,
    gate: projected.gate, pass_score: projected.passScore, judge_type: projected.judgeType, judge_model: projected.judgeModel,
    version: projected.version, status: projected.status,
    ...(projected.modelProviderId === undefined ? {} : { model_provider_id: projected.modelProviderId }) }
}

async function findRubric(client: SqlClient, workspaceId: string, rubricId: string, lock: boolean): Promise<RubricRow> {
  const row = (await client.query<RubricRow>(`SELECT * FROM rubrics WHERE workspace_id=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`,
    [workspaceId, rubricId])).rows[0]
  if (!row) throw new ApiError(404, '评分量规不存在')
  return row
}

function projectVersion(row: VersionRow) {
  if (!object(row.snapshot) || typeof row.id !== 'string' || typeof row.version !== 'string'
    || !Number.isFinite(new Date(row.created_at).getTime())) throw historyError()
  return { id: row.id, version: row.version, createdAt: new Date(row.created_at).toISOString(),
    snapshot: projectRubric({ ...row.snapshot, model_provider_id: row.snapshot.model_provider_id ?? null } as RubricRow) }
}

async function ensureDefaults(client: SqlClient, workspaceId: string): Promise<void> {
  if ((await client.query('SELECT id FROM rubrics WHERE workspace_id=$1 LIMIT 1', [workspaceId])).rows.length) return
  await client.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [workspaceId])
  if ((await client.query('SELECT id FROM rubrics WHERE workspace_id=$1 LIMIT 1', [workspaceId])).rows.length) return
  for (const [index, template] of DEFAULT_RUBRICS.entries()) {
    await insertRubric(client, { ...template, id: randomUUID(), workspace_id: workspaceId, sort_order: index + 1,
      judge_type: 'deterministic', judge_model: '', model_provider_id: null })
  }
}

async function requireProvider(client: SqlClient, workspaceId: string, providerId: string): Promise<void> {
  const provider = (await client.query<Record<string, unknown>>(
    'SELECT provider_type,base_url,default_model,secret_ref,status FROM model_providers WHERE workspace_id=$1 AND id=$2 FOR SHARE',
    [workspaceId, providerId])).rows[0]
  if (!provider) throw new ApiError(422, '模型 Provider 不属于当前 Workspace')
  if (provider.status === 'disabled') throw new ApiError(422, '模型 Provider 已停用')
  if (['provider_type', 'base_url', 'default_model', 'secret_ref'].some(key => typeof provider[key] !== 'string' || !strip(provider[key]))
    || typeof provider.secret_ref !== 'string' || !/^[A-Z_][A-Z0-9_]*$/.test(strip(provider.secret_ref))) {
    throw new ApiError(422, '模型 Provider 配置不完整')
  }
}

async function insertRubric(client: SqlClient, row: RubricRow): Promise<void> {
  await client.query(`INSERT INTO rubrics
    (id,workspace_id,name,artifact,dimensions,gate,pass_score,judge_type,judge_model,model_provider_id,version,status,sort_order,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,
  [row.id, row.workspace_id, row.name, row.artifact, JSON.stringify(row.dimensions), row.gate, row.pass_score,
    row.judge_type, row.judge_model, row.model_provider_id, row.version, row.status, row.sort_order, new Date()])
}

function projectRubric(row: RubricRow) {
  if (!Array.isArray(row.dimensions) || ['id', 'name', 'artifact', 'gate', 'judge_model', 'version', 'status'].some(key =>
    typeof row[key as keyof RubricRow] !== 'string') || !Number.isInteger(row.pass_score)
    || !['deterministic', 'llm'].includes(row.judge_type)
    || (row.model_provider_id !== null && typeof row.model_provider_id !== 'string')) throw historyError()
  const dimensions = row.dimensions.map(item => {
    if (!object(item) || typeof item.name !== 'string' || !Number.isInteger(item.weight)
      || (item.id != null && typeof item.id !== 'string') || (item.criteria != null && typeof item.criteria !== 'string')) throw historyError()
    return { name: item.name, weight: item.weight, ...(item.id == null ? {} : { id: item.id }),
      ...(item.criteria == null ? {} : { criteria: item.criteria }) }
  })
  return { id: row.id, name: row.name, artifact: row.artifact, dimensions, gate: row.gate, passScore: row.pass_score,
    judgeType: row.judge_type, judgeModel: row.judge_model, version: row.version, status: row.status,
    ...(row.model_provider_id === null ? {} : { modelProviderId: row.model_provider_id }) }
}
