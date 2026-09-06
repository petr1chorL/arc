import { randomUUID } from 'node:crypto'
import { ApiError } from '../identity-workspace/handler.ts'
import { createTransactionBackend, workspaceContext, requireCapability, recordAudit, type SqlPool } from '../identity-workspace/postgres.ts'
import { createPostgresWorkflowDirectoryBackend } from './directory.ts'
import type { WorkflowsInput } from './handler.ts'
import { object, parseWorkflowWrite, parseWorkflowPublish, type WorkflowFields } from './policy.ts'
import { loadWorkflowCatalog, validateWorkflow, type WorkflowCatalog } from './validation.ts'
import { strip } from '../rubrics/policy.ts'

type WorkflowRow = WorkflowFields & { id: string; workspace_id: string; status: string; version: string; created_at: Date | string; updated_at: Date | string }
type VersionRow = { id: string; workflow_id: string; workspace_id: string; version: string; snapshot: unknown; note: string; created_at: Date | string }
const historyError = () => new ApiError(409, '历史 Workflow 数据结构不符合要求，需先完成治理')

export function createPostgresWorkflowsBackend(pool: SqlPool) {
  const directory = createPostgresWorkflowDirectoryBackend(pool)
  const lifecycle = createTransactionBackend<WorkflowsInput>(pool, async (client, input) => {
    const { operation, params } = input.route
    const write = ['create', 'update', 'delete', 'publish'].includes(operation)
    const context = await workspaceContext(client, input, write)
    const action = operation === 'get' ? 'read' : operation === 'versions' ? 'version.list' : operation
    const audit = { action: `workflow.${action}`, targetType: operation === 'list' ? 'workspace' : 'workflow', targetId: params.workflowId ?? (operation === 'list' ? params.workspaceId : null) }
    await requireCapability(client, context, input, operation === 'publish' ? 'workflow.publish' : write ? 'workflow.write' : 'asset.read', audit)
    if (operation === 'list') {
      const result = await client.query<WorkflowRow>("SELECT * FROM workflows WHERE workspace_id=$1 AND status <> '已删除' ORDER BY updated_at DESC", [context.workspace.id])
      return { body: result.rows.map(projectWorkflow) }
    }
    if (operation === 'create') {
      const fields = parseWorkflowWrite(input.body), now = new Date()
      const row: WorkflowRow = { ...fields, id: randomUUID(), workspace_id: context.workspace.id, status: '草稿', version: '未发布', created_at: now, updated_at: now }
      await client.query(`INSERT INTO workflows (id,workspace_id,name,status,version,nodes,edges,input_schema,output_schema,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`, [row.id, row.workspace_id, row.name, row.status, row.version,
        JSON.stringify(row.nodes), JSON.stringify(row.edges), JSON.stringify(row.input_schema), JSON.stringify(row.output_schema), now])
      await recordAudit(client, context, input, { ...audit, workspaceId: context.workspace.id, targetId: row.id, outcome: 'success' })
      return { status: 201, body: projectWorkflow(row) }
    }
    const row = (await client.query<WorkflowRow>(
      `SELECT * FROM workflows WHERE workspace_id=$1 AND id=$2${operation === 'versions' ? '' : " AND status <> '已删除'"}${write ? ' FOR UPDATE' : ''}`,
      [context.workspace.id, params.workflowId])).rows[0]
    if (!row) throw new ApiError(404, '工作流不存在')
    if (operation === 'get') return { body: projectWorkflow(row) }
    if (operation === 'versions') {
      const versions = await client.query<VersionRow>('SELECT * FROM workflow_versions WHERE workspace_id=$1 AND workflow_id=$2 ORDER BY created_at DESC', [context.workspace.id, row.id])
      const catalog = await loadWorkflowCatalog(client, context.workspace.id, false)
      return { body: versions.rows.map(version => { requireHistoricalReferences(version, catalog); return projectVersion(version, row.id) }) }
    }
    if (operation === 'update') {
      Object.assign(row, parseWorkflowWrite(input.body), { status: '草稿', updated_at: new Date() })
      await client.query('UPDATE workflows SET name=$1,nodes=$2,edges=$3,input_schema=$4,output_schema=$5,status=$6,updated_at=$7 WHERE id=$8 AND workspace_id=$9',
        [row.name, JSON.stringify(row.nodes), JSON.stringify(row.edges), JSON.stringify(row.input_schema), JSON.stringify(row.output_schema), row.status, row.updated_at, row.id, context.workspace.id])
    } else if (operation === 'delete') {
      await client.query("UPDATE workflows SET status='已删除',updated_at=$1 WHERE id=$2 AND workspace_id=$3", [new Date(), row.id, context.workspace.id])
    } else {
      const note = operation === 'publish' ? parseWorkflowPublish(input.body) : ''
      projectWorkflow(row)
      const catalog = await loadWorkflowCatalog(client, context.workspace.id, operation === 'publish')
      const errors = validateWorkflow(row.nodes, row.edges, catalog)
      if (operation === 'validate') return { body: { valid: !errors.length, errors } }
      if (errors.length) return { status: 422, body: { detail: errors } }
      const count = (await client.query<{ n: number }>('SELECT count(*)::int n FROM workflow_versions WHERE workspace_id=$1 AND workflow_id=$2', [context.workspace.id, row.id])).rows[0].n
      const version = count ? `v1.${count}.0` : 'v1.0.0'
      if ((await client.query('SELECT id FROM workflow_versions WHERE workspace_id=$1 AND workflow_id=$2 AND version=$3', [context.workspace.id, row.id, version])).rows.length) throw new ApiError(409, 'Workflow version already exists')
      const published: VersionRow = { id: randomUUID(), workspace_id: context.workspace.id, workflow_id: row.id, version, snapshot: workflowSnapshot(row, catalog), note, created_at: new Date() }
      await client.query('INSERT INTO workflow_versions (id,workspace_id,workflow_id,version,snapshot,note,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [published.id, published.workspace_id, row.id, version, JSON.stringify(published.snapshot), note, published.created_at])
      await client.query("UPDATE workflows SET version=$1,status='已发布',updated_at=$2 WHERE id=$3 AND workspace_id=$4", [version, published.created_at, row.id, context.workspace.id])
      await recordAudit(client, context, input, { ...audit, workspaceId: context.workspace.id, outcome: 'success' })
      return { status: 201, body: projectVersion(published, row.id) }
    }
    await recordAudit(client, context, input, { ...audit, workspaceId: context.workspace.id, outcome: 'success' })
    return operation === 'delete' ? { status: 204 } : { body: projectWorkflow(row) }
  })
  return (input: WorkflowsInput) => ['reviewers', 'review-groups'].includes(input.route.operation) ? directory(input) : lifecycle(input)
}

function projectWorkflow(row: WorkflowRow) {
  if (!['id', 'name', 'status', 'version'].every(field => typeof row[field as keyof WorkflowRow] === 'string')
    || !Array.isArray(row.nodes) || !Array.isArray(row.edges) || !object(row.input_schema) || !object(row.output_schema)) throw historyError()
  try { parseWorkflowWrite({ ...row, name: row.name || ' ' }) } catch { throw historyError() }
  const created = new Date(row.created_at), updated = new Date(row.updated_at)
  if (!Number.isFinite(created.getTime()) || !Number.isFinite(updated.getTime())) throw historyError()
  return { id: row.id, name: row.name, status: row.status, version: row.version, nodes: row.nodes, edges: row.edges,
    inputSchema: row.input_schema, outputSchema: row.output_schema, createdAt: created.toISOString(), updatedAt: updated.toISOString() }
}

function projectVersion(row: VersionRow, workflowId: string) {
  if (!object(row.snapshot) || row.snapshot.id !== workflowId || typeof row.note !== 'string') throw historyError()
  const value = row.snapshot
  projectWorkflow({ ...value, input_schema: value.inputSchema, output_schema: value.outputSchema,
    created_at: value.createdAt, updated_at: value.updatedAt } as WorkflowRow)
  const created = new Date(row.created_at)
  if (!Number.isFinite(created.getTime())) throw historyError()
  return { id: row.id, version: row.version, snapshot: row.snapshot, note: row.note, createdAt: created.toISOString() }
}

function workflowSnapshot(row: WorkflowRow, catalog: WorkflowCatalog) {
  const snapshot = structuredClone(projectWorkflow(row))
  for (const node of snapshot.nodes) for (const field of ['inputDataObjectRef', 'outputDataObjectRef']) {
    const ref = node.data[field]
    if (!object(ref)) continue
    const version = catalog.dataVersions.find(item => item.definition_id === ref.definitionId && item.version === ref.version)
    if (!version) continue
    if (!object(version.snapshot) || version.snapshot.id !== ref.definitionId || !object(version.snapshot.schema)) throw historyError()
    node.data[field] = { ...ref, versionId: version.id, snapshot: version.snapshot }
  }
  return snapshot
}

function requireHistoricalReferences(version: VersionRow, catalog: WorkflowCatalog) {
  projectVersion(version, version.workflow_id)
  const snapshot = version.snapshot as { nodes: { type: string; data: Record<string, unknown> }[] }
  for (const node of snapshot.nodes) {
    const data = node.data
    if (node.type === 'agent' && !catalog.agentVersions.some(row => row.agent_id === data.agentId && row.version === data.agentVersion)) throw historyError()
    for (const field of ['inputDataObjectRef', 'outputDataObjectRef', ...(node.type === 'evaluation' ? ['rubricRef'] : [])]) {
      const ref = data[field]
      if (ref == null || ref === false || ref === '' || (object(ref) && !Object.keys(ref).length)) {
        if (field === 'rubricRef') throw historyError()
        continue
      }
      if (!object(ref)) throw historyError()
      if (field !== 'rubricRef' && Object.hasOwn(ref, 'snapshot')
        && (!object(ref.snapshot) || ref.snapshot.id !== ref.definitionId || !object(ref.snapshot.schema))) throw historyError()
      const rows = field === 'rubricRef' ? catalog.rubricVersions : catalog.dataVersions
      const key = field === 'rubricRef' ? 'rubric_id' : 'definition_id'
      const identity = (value: unknown) => field === 'rubricRef' && typeof value === 'string' ? strip(value) : value
      const id = identity(field === 'rubricRef' ? ref.rubricId : ref.definitionId)
      if (!rows.some(row => row[key] === id && row.version === identity(ref.version) && (ref.versionId == null || row.id === identity(ref.versionId)))) throw historyError()
    }
  }
}
