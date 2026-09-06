import type { SqlClient } from '../identity-workspace/postgres.ts'
import { casefold } from '../rubrics/casefold.ts'
import { strip } from '../rubrics/policy.ts'
import { object, type WorkflowEdge, type WorkflowNode } from './policy.ts'

type Row = Record<string, unknown>
export type WorkflowCatalog = {
  agents: Row[]; agentVersions: Row[]; definitions: Row[]; dataVersions: Row[];
  rubrics: Row[]; rubricVersions: Row[]; providers: Row[]; reviewers: Row[]; groups: Row[]; members: Row[]
}

/** Shared dependency locks follow each asset's definition-before-Provider write order. */
export async function loadWorkflowCatalog(client: SqlClient, workspaceId: string, lock: boolean): Promise<WorkflowCatalog> {
  const read = async (table: string) => (await client.query<Row>(
    `SELECT * FROM ${table} WHERE workspace_id=$1 ORDER BY id${lock ? ' FOR SHARE' : ''}`, [workspaceId])).rows
  // Only these source-controlled table names reach SQL; no request text is interpolated.
  const agents = await read('agents')
  const agentVersions = await read('agent_versions')
  const definitions = await read('data_object_definitions')
  const dataVersions = await read('data_object_versions')
  const rubrics = await read('rubrics')
  const rubricVersions = await read('rubric_versions')
  const providers = await read('model_providers')
  const reviewers = await read('reviewers')
  const groups = await read('review_groups')
  const members = await read('review_group_members')
  return { agents, agentVersions, definitions, dataVersions, rubrics, rubricVersions, providers, reviewers, groups, members }
}

const nonempty = (value: unknown): value is string => typeof value === 'string' && Boolean(strip(value))
// Unicode 15.0 Nd zero points, matching the project's Python 3.12 int(string) contract.
const decimalZeros = [48, 1632, 1776, 1984, 2406, 2534, 2662, 2790, 2918, 3046, 3174, 3302, 3430, 3558, 3664, 3792, 3872, 4160, 4240, 6112, 6160, 6470, 6608, 6784, 6800, 6992, 7088, 7232, 7248, 42528, 43216, 43264, 43472, 43504, 43600, 44016, 65296, 66720, 68912, 69734, 69872, 69942, 70096, 70384, 70736, 70864, 71248, 71360, 71472, 71904, 72016, 72784, 73040, 73120, 73552, 92768, 92864, 93008, 120782, 120792, 120802, 120812, 120822, 123200, 123632, 124144, 125264, 130032]
const asciiDigits = (value: string) => Array.from(value, character => {
  const code = character.codePointAt(0)!
  const zero = decimalZeros.find(start => code >= start && code < start + 10)
  return zero === undefined ? character : String(code - zero)
}).join('')
const validPath = (value: unknown) => typeof value === 'string' && (strip(value) === '$' || (strip(value).startsWith('$.') && strip(value).slice(2).split('.').some(Boolean)))

export function structuralErrors(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[] {
  const errors: string[] = []
  const ids = new Set(nodes.map(node => node.id))
  if (nodes.length !== ids.size) errors.push('节点 ID 必须唯一')
  if (!nodes.some(node => node.type === 'trigger')) errors.push('工作流至少需要一个触发节点')
  if (!nodes.some(node => node.type === 'end')) errors.push('工作流至少需要一个结束节点')
  const incoming = new Map([...ids].map(id => [id, 0]))
  const adjacency = new Map([...ids].map(id => [id, [] as string[]]))
  for (const edge of edges) {
    const mappings = edge.data?.mappings === undefined ? [] : edge.data.mappings
    if (!Array.isArray(mappings)) errors.push(`连线 ${edge.id} 的映射必须是数组`)
    else for (const mapping of mappings) {
      if (!object(mapping)) { errors.push(`连线 ${edge.id} 的映射项格式无效`); continue }
      for (const field of ['sourcePath', 'targetPath']) if (!validPath(mapping[field])) errors.push(`连线 ${edge.id} 的映射 ${field} 路径无效`)
    }
    if (!ids.has(edge.source) || !ids.has(edge.target)) { errors.push(`连线 ${edge.id} 引用了不存在的节点`); continue }
    if (edge.source === edge.target) errors.push(`节点 ${edge.source} 不允许自环`)
    adjacency.get(edge.source)!.push(edge.target)
    incoming.set(edge.target, incoming.get(edge.target)! + 1)
  }
  const queue = [...ids].filter(id => incoming.get(id) === 0)
  let visited = 0
  for (let index = 0; index < queue.length; index++) {
    visited++
    for (const target of adjacency.get(queue[index])!) {
      incoming.set(target, incoming.get(target)! - 1)
      if (incoming.get(target) === 0) queue.push(target)
    }
  }
  if (ids.size && visited !== ids.size) errors.push('工作流不能包含有向环')
  return errors
}

export function validateWorkflow(nodes: WorkflowNode[], edges: WorkflowEdge[], catalog: WorkflowCatalog): string[] {
  const errors = structuralErrors(nodes, edges)
  for (const node of nodes) {
    for (const [field, label] of [['inputDataObjectRef', '输入'], ['outputDataObjectRef', '输出']]) {
      const ref = node.data[field]
      if (ref == null || ref === false || ref === '' || (object(ref) && !Object.keys(ref).length)) continue
      const prefix = `节点 ${node.id} 的${label} Data Object`
      if (!object(ref)) { errors.push(`${prefix} 引用格式无效`); continue }
      if (!nonempty(ref.definitionId)) { errors.push(`${prefix} 必须包含 Definition ID`); continue }
      const definition = catalog.definitions.find(row => row.id === ref.definitionId)
      if (!definition) { errors.push(`${prefix} ${ref.definitionId} 不存在`); continue }
      if (definition.status !== 'published' || definition.version === 'unpublished') { errors.push(`${prefix} ${definition.name} 尚未发布`); continue }
      if (!nonempty(ref.version) || ref.version === 'unpublished') { errors.push(`${prefix} 必须绑定已发布版本`); continue }
      if (!catalog.dataVersions.some(row => row.definition_id === ref.definitionId && row.version === ref.version)) errors.push(`${prefix} 版本 ${ref.version} 不存在`)
    }
    if (node.type === 'agent') {
      const retry = node.data.retryMaxAttempts === undefined ? 2 : node.data.retryMaxAttempts
      if (typeof retry !== 'number' || !Number.isInteger(retry) || retry < 1 || retry > 3) errors.push(`Agent 节点 ${node.id} 的重试次数必须是 1–3 的整数`)
      const { agentId, agentVersion } = node.data
      if (!nonempty(agentId) || !nonempty(agentVersion)) errors.push(`Agent 节点 ${node.id} 必须选择已发布版本`)
      else if (!catalog.agentVersions.some(row => row.agent_id === agentId && row.version === agentVersion)) errors.push(`Agent 版本 ${agentId}@${agentVersion} 不存在`)
    } else if (node.type === 'evaluation') evaluationErrors(node, edges, catalog, errors)
    else if (node.type === 'human') humanErrors(node, catalog, errors)
  }
  return errors
}

function evaluationErrors(node: WorkflowNode, edges: WorkflowEdge[], catalog: WorkflowCatalog, errors: string[]) {
  const prefix = `评估节点 ${node.id}`
  if (edges.filter(edge => edge.target === node.id).length !== 1) errors.push(`${prefix} 必须恰好有 1 条入边`)
  const ref = node.data.rubricRef
  if (!object(ref) || !['rubricId', 'versionId', 'version', 'name'].every(field => nonempty(ref[field]))) { errors.push(`${prefix} 必须选择已发布评估模板版本`); return }
  const rubric = catalog.rubrics.find(row => row.id === strip(ref.rubricId as string))
  if (!rubric) { errors.push(`${prefix} 的评分模板版本不存在`); return }
  if (rubric.status !== 'active') { errors.push(`${prefix} 的评分模板不可用`); return }
  const version = catalog.rubricVersions.find(row => row.id === strip(ref.versionId as string) && row.rubric_id === rubric.id && row.version === strip(ref.version as string))
  if (!version) { errors.push(`${prefix} 的评分模板版本不存在`); return }
  const snapshot = object(version.snapshot) ? version.snapshot : {}
  const judge = snapshot.judgeType ?? snapshot.judge_type
  const model = snapshot.judgeModel ?? snapshot.judge_model
  const providerId = snapshot.modelProviderId ?? snapshot.model_provider_id
  const dimensions = snapshot.dimensions
  let total = 0
  const ids = new Set<string>(), names = new Set<string>()
  const dimensionsValid = Array.isArray(dimensions) && dimensions.length > 0 && dimensions.every(dimension => {
    if (!object(dimension) || !nonempty(dimension.id) || !nonempty(dimension.name) || !nonempty(dimension.criteria)
      || typeof dimension.weight !== 'number' || !Number.isInteger(dimension.weight) || dimension.weight < 1 || dimension.weight > 100) return false
    const id = casefold(strip(dimension.id)), name = casefold(strip(dimension.name))
    if (ids.has(id) || names.has(name)) return false
    ids.add(id); names.add(name); total += dimension.weight
    return true
  }) && total === 100
  if (judge !== 'llm' || !nonempty(model) || !nonempty(providerId) || !dimensionsValid) { errors.push(`${prefix} 的评分模板版本不兼容工作流评估`); return }
  const provider = catalog.providers.find(row => row.id === strip(providerId))
  if (!provider || provider.status === 'disabled') { errors.push(`${prefix} 的模型 Provider 不可用`); return }
  if (!['provider_type', 'base_url', 'default_model', 'secret_ref'].every(field => nonempty(provider[field]))
    || !/^[A-Z_][A-Z0-9_]*$/.test(strip(provider.secret_ref as string))) errors.push(`${prefix} 的模型 Provider 配置不完整`)
}

function humanErrors(node: WorkflowNode, catalog: WorkflowCatalog, errors: string[]) {
  const data = node.data, prefix = `Human 节点 ${node.id}`
  const assignment = data.assignmentType === undefined ? 'group_claim' : typeof data.assignmentType === 'string' ? data.assignmentType : ''
  const direct = assignment === 'direct' || assignment === 'direct_reviewer'
  let ids = data.reviewerIds === undefined ? [] : data.reviewerIds
  if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string' && Boolean(id))) {
    errors.push(`${prefix} 的审核人列表格式无效`); ids = []
  }
  const reviewerIds = ids as string[]
  let groupId = data.groupId
  if (groupId != null && (typeof groupId !== 'string' || !groupId)) { errors.push(`${prefix} 的审核组引用格式无效`); groupId = null }
  if (!reviewerIds.length && !groupId) groupId = [...catalog.groups].sort((a, b) => new Date(String(a.created_at)).getTime() - new Date(String(b.created_at)).getTime()).find(row => row.is_escalation_group === false)?.id
  if (!['direct', 'direct_reviewer', 'group_claim', 'round_robin'].includes(String(assignment))) errors.push(`${prefix} 的分配方式无效`)
  if (direct && !reviewerIds.length) errors.push(`${prefix} 直接分配必须选择审核人`)
  if (assignment === 'round_robin' && !groupId) errors.push(`${prefix} 轮询分配必须选择审核组`)
  const approvals = integer('requiredApprovals', 1, '通过人数')
  const active = new Set(catalog.reviewers.filter(row => row.is_active === true).map(row => row.id))
  if (reviewerIds.some(id => !active.has(id))) errors.push(`${prefix} 的审核人不存在或不可用`)
  const group = catalog.groups.find(row => row.id === groupId)
  if (groupId && !group) errors.push(`${prefix} 的审核组不存在`)
  const participants = direct || !groupId ? new Set(reviewerIds.filter(id => active.has(id))).size
    : !group ? 0 : new Set(catalog.members.filter(row => row.group_id === groupId && active.has(row.reviewer_id)).map(row => row.reviewer_id)).size
  function integer(field: string, fallback: number, label: string): number | bigint {
    const value = data[field] === undefined ? fallback : data[field]
    if (typeof value === 'string') {
      const normalized = asciiDigits(strip(value))
      if (/^[+-]?[0-9](?:_?[0-9])*$/.test(normalized)) return BigInt(normalized.replaceAll('_', ''))
    }
    if (typeof value !== 'number' || !Number.isInteger(value)) { errors.push(`${prefix} 的${label}必须是整数`); return fallback }
    return value
  }
  if (data.reviewPolicy === 'threshold' && approvals !== null) {
    if (approvals <= 0) errors.push(`${prefix} 的通过人数必须大于 0`)
    if (approvals > participants) errors.push(`${prefix} 的通过人数不能超过参与审核人数`)
  }
  const due = integer('dueMinutes', 240, '截止时间'), escalation = integer('escalationMinutes', 480, '升级时间')
  if (due !== null && due <= 0) errors.push(`${prefix} 的截止时间必须大于 0`)
  if (due !== null && escalation !== null && escalation <= due) errors.push(`${prefix} 的升级时间必须晚于截止时间`)
}
