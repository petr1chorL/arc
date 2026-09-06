import { randomUUID } from 'node:crypto'
import { ApiError } from '../identity-workspace/handler.ts'
import { createTransactionBackend, workspaceContext, requireCapability, recordAudit, type SqlPool } from '../identity-workspace/postgres.ts'
import type { DataObjectsInput } from './handler.ts'
import { parseDataObjectCreate, parseDataObjectUpdate } from './policy.ts'

type DefinitionRow = {
  id: string; workspace_id: string; name: string; description: string; schema: unknown
  status: string; version: string; created_by: string; created_at: Date | string; updated_at: Date | string
}
type VersionRow = {
  id: string; definition_id: string; version: string; snapshot: unknown; created_at: Date | string
}
const historyError = () => new ApiError(409, '历史 Data Object 版本结构不符合要求，需先完成治理')
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

export function createPostgresDataObjectsBackend(pool: SqlPool) {
  const backend = createTransactionBackend<DataObjectsInput>(pool, async (client, input) => {
    const { operation, params } = input.route
    const write = !['list', 'versions'].includes(operation)
    const context = await workspaceContext(client, input, write)
    const audit = { action: `data_object_definition.${operation === 'versions' ? 'versions.list' : operation}`,
      targetType: operation === 'list' ? 'workspace' : 'data_object_definition',
      targetId: operation === 'list' ? params.workspaceId : params.definitionId ?? null }
    await requireCapability(client, context, input, write ? 'agent.write' : 'asset.read', audit)
    if (operation === 'list') {
      const rows = await client.query<DefinitionRow>('SELECT * FROM data_object_definitions WHERE workspace_id=$1 ORDER BY created_at DESC',
        [context.workspace.id])
      return { body: rows.rows.map(projectDefinition) }
    }
    if (operation === 'create') {
      const data = parseDataObjectCreate(input.body)
      const now = new Date()
      const row: DefinitionRow = { id: randomUUID(), workspace_id: context.workspace.id, name: data.name,
        description: data.description, schema: data.object_schema, status: 'draft', version: 'unpublished',
        created_by: context.user.id, created_at: now, updated_at: now }
      await client.query(`INSERT INTO data_object_definitions
        (id,workspace_id,name,description,schema,status,version,created_by,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
      [row.id, row.workspace_id, row.name, row.description, JSON.stringify(row.schema), row.status, row.version, row.created_by, now])
      await recordAudit(client, context, input, { ...audit, workspaceId: context.workspace.id, targetId: row.id, outcome: 'success' })
      return { status: 201, body: projectDefinition(row) }
    }
    const row = (await client.query<DefinitionRow>(
      `SELECT * FROM data_object_definitions WHERE workspace_id=$1 AND id=$2${write ? ' FOR UPDATE' : ''}`,
      [context.workspace.id, params.definitionId])).rows[0]
    if (!row) throw new ApiError(404, 'Data Object definition does not exist')
    if (operation === 'versions') {
      const versions = await client.query<VersionRow>(
        'SELECT * FROM data_object_versions WHERE workspace_id=$1 AND definition_id=$2 ORDER BY created_at DESC',
        [context.workspace.id, row.id])
      return { body: versions.rows.map(projectVersion) }
    }
    if (operation === 'update') {
      const data = parseDataObjectUpdate(input.body)
      if (data.name !== undefined) row.name = data.name
      if (data.description !== undefined) row.description = data.description
      if (data.object_schema !== undefined) row.schema = data.object_schema
      row.updated_at = new Date()
      const body = projectDefinition(row)
      await client.query('UPDATE data_object_definitions SET name=$1,description=$2,schema=$3,updated_at=$4 WHERE workspace_id=$5 AND id=$6',
        [row.name, row.description, JSON.stringify(row.schema), row.updated_at, context.workspace.id, row.id])
      await recordAudit(client, context, input, { ...audit, workspaceId: context.workspace.id, outcome: 'success' })
      return { body }
    }
    const count = (await client.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM data_object_versions WHERE workspace_id=$1 AND definition_id=$2',
      [context.workspace.id, row.id])).rows[0].n
    const version = count ? `v1.${count}.0` : 'v1.0.0'
    if ((await client.query('SELECT id FROM data_object_versions WHERE workspace_id=$1 AND definition_id=$2 AND version=$3',
      [context.workspace.id, row.id, version])).rows.length) throw new ApiError(409, 'Data Object version already exists')
    const published: VersionRow = { id: randomUUID(), definition_id: row.id, version,
      snapshot: projectDefinition(row), created_at: new Date() }
    await client.query(`INSERT INTO data_object_versions (id,workspace_id,definition_id,version,snapshot,created_at)
      VALUES ($1,$2,$3,$4,$5,$6)`,
    [published.id, context.workspace.id, row.id, version, JSON.stringify(published.snapshot), published.created_at])
    await client.query(`UPDATE data_object_definitions SET status='published',version=$1,updated_at=$2 WHERE workspace_id=$3 AND id=$4`,
      [version, published.created_at, context.workspace.id, row.id])
    await recordAudit(client, context, input, { ...audit, workspaceId: context.workspace.id, outcome: 'success' })
    return { status: 201, body: projectVersion(published) }
  })
  return async (input: DataObjectsInput) => {
    try { return await backend(input) } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
        && 'constraint' in error && error.constraint === 'uq_data_object_definition_workspace_name') {
        throw new ApiError(409, 'Data Object definition name already exists')
      }
      throw error
    }
  }
}

function projectDefinition(row: DefinitionRow) {
  if (!isObject(row.schema)) throw historyError()
  return { id: row.id, name: row.name, description: row.description, schema: row.schema, status: row.status,
    version: row.version, createdBy: row.created_by, createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString() }
}

function projectVersion(row: VersionRow) {
  if (!isObject(row.snapshot) || !isObject(row.snapshot.schema)) throw historyError()
  return { id: row.id, definitionId: row.definition_id, version: row.version, snapshot: row.snapshot,
    createdAt: new Date(row.created_at).toISOString() }
}
