// Synthetic loopback database only. Never loads application credentials or production data.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { createIdentityWorkspaceHandler } from '../netlify/functions/_shared/identity-workspace/handler.ts'
import { createPostgresIdentityWorkspaceBackend } from '../netlify/functions/_shared/identity-workspace/postgres.ts'
import { hashPassword } from '../netlify/functions/_shared/identity-workspace/security.ts'
import { createWorkflowsHandler } from '../netlify/functions/_shared/workflows/handler.ts'
import { createPostgresWorkflowsBackend } from '../netlify/functions/_shared/workflows/postgres.ts'

const { Pool } = createRequire(import.meta.resolve('@netlify/database'))('pg')
const port = process.argv[2] ?? '5432'
assert(/^[0-9]{1,5}$/.test(port) && Number(port) > 0 && Number(port) < 65536)
const connection = { host: '127.0.0.1', port: Number(port), user: 'postgres', database: 'arc_identity_test', connectionTimeoutMillis: 5000 }
const schema = `workflow_test_${randomUUID().replaceAll('-', '')}`
const admin = new Pool(connection)
const pool = new Pool({ ...connection, options: `-c search_path=${schema}`, statement_timeout: 10000 })
const identity = createIdentityWorkspaceHandler(createPostgresIdentityWorkspaceBackend(pool))
const handler = createWorkflowsHandler(createPostgresWorkflowsBackend(pool))
let cookie = '', csrf = '', checks = 0
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++ }
function request(path, selected = handler, method = 'GET', body) {
  return selected(new Request(`https://synthetic.invalid${path}`, { method, headers: { Cookie: cookie, 'X-CSRF-Token': csrf },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
}
try {
  await admin.query(`CREATE SCHEMA ${schema}`)
  for (const name of ['20260904060000_create-arc-one-baseline', '20260904133000_create-identity-rate-limits']) {
    await pool.query(readFileSync(new URL(`../netlify/database/migrations/${name}/migration.sql`, import.meta.url), 'utf8'))
  }
  await pool.query("INSERT INTO organizations VALUES ('org','Synthetic','synthetic','active',now(),now())")
  for (const id of ['a', 'b']) await pool.query("INSERT INTO workspaces (id,organization_id,name,slug,status,created_at,updated_at) VALUES ($1,'org',$1,$1,'active',now(),now())", [id])
  const password = `Synthetic-${randomUUID()}!`
  await pool.query(`INSERT INTO users (id,organization_id,email,normalized_email,display_name,password_hash,status,is_organization_admin,failed_login_count,created_at,updated_at)
    VALUES ('actor','org','actor@example.invalid','actor@example.invalid','Synthetic',$1,'active',false,0,now(),now())`, [await hashPassword(password)])
  await pool.query("INSERT INTO workspace_memberships (id,workspace_id,user_id,role,status,created_at,updated_at) VALUES ('member','a','actor','viewer','active',now(),now())")
  for (const [id, workspaceId, active, date] of [['later','a',false,'2026-01-02'], ['earlier','a',true,'2026-01-01'], ['foreign','b',true,'2025-01-01']]) {
    await pool.query("INSERT INTO reviewers (id,workspace_id,user_id,name,role,is_expert,is_active,created_at) VALUES ($1,$2,NULL,$1,'expert',true,$3,$4)", [id, workspaceId, active, date])
  }
  for (const [id, workspaceId] of [['group-a','a'],['group-b','b']]) {
    await pool.query("INSERT INTO review_groups (id,workspace_id,name,assignment_mode,rotation_cursor,is_escalation_group,created_at) VALUES ($1,$2,$1,'group_claim',0,false,now())", [id, workspaceId])
  }
  for (const [id, reviewerId, workspaceId] of [['m1','earlier','a'], ['m2','later','a'], ['bad-reviewer','foreign','a'], ['bad-membership','foreign','b']]) {
    // The last link uses another group to avoid the baseline's group/reviewer unique constraint.
    await pool.query("INSERT INTO review_group_members (id,workspace_id,group_id,reviewer_id,role) VALUES ($1,$2,$3,$4,'reviewer')", [id, workspaceId, id === 'bad-membership' ? 'group-b' : 'group-a', reviewerId])
  }
  equal((await request('/api/workspaces/a/reviewers')).status, 401, 'anonymous denied')
  const login = await request('/api/auth/login', identity, 'POST', { email: 'actor@example.invalid', password })
  equal(login.status, 200, 'login response')
  cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  csrf = decodeURIComponent(cookie.match(/arc_one_csrf=([^;]+)/)[1])
  const expected = ['earlier', 'later'].map(id => ({ id, userId: null, name: id, role: 'expert', isExpert: true, isActive: id === 'earlier' }))
  for (const role of ['viewer', 'operator', 'builder', 'workspace_admin']) {
    await pool.query("UPDATE workspace_memberships SET role=$1 WHERE id='member'", [role])
    equal(await (await request('/api/workspaces/a/reviewers')).json(), expected, `${role}: sorted scoped reviewers with nullable user and inactive entries`)
    equal(await (await request('/api/workspaces/a/review-groups')).json(), [{ id: 'group-a', name: 'group-a', assignmentMode: 'group_claim', isEscalationGroup: false, members: expected }], `${role}: group excludes foreign reviewer`)
  }
  for (const suffix of ['reviewers', 'review-groups']) {
    equal((await request(`/api/workspaces/b/${suffix}`)).status, 404, 'nonmember space denied')
    equal((await request(`/api/workspaces/a/${suffix}`, handler, 'POST', {})).status, 404, 'directory mutation excluded')
  }
  equal((await pool.query('SELECT count(*)::int n FROM human_tasks')).rows[0].n, 0, 'directory never creates tasks')
  equal((await pool.query('SELECT count(*)::int n FROM workflow_runs')).rows[0].n, 0, 'directory never starts runs')
  const graph = { name: 'Synthetic workflow', nodes: [
    { id: 'start', type: 'trigger', position: { x: 0, y: 0 }, data: {} },
    { id: 'end', type: 'end', position: { x: 200, y: 0 }, data: {} },
  ], edges: [{ id: 'edge', source: 'start', target: 'end' }] }
  const createdResponse = await request('/api/workspaces/a/workflows', handler, 'POST', graph)
  equal(createdResponse.status, 201, 'create workflow')
  const created = await createdResponse.json()
  const path = `/api/workspaces/a/workflows/${created.id}`
  equal([created.status, created.version], ['草稿', '未发布'], 'draft state')
  equal(await (await request(path)).json(), created, 'persisted draft')
  equal(await (await request(`${path}/validate`, handler, 'POST')).json(), { valid: true, errors: [] }, 'validate')
  const firstResponse = await request(`${path}/publish`, handler, 'POST', { note: ' first ' })
  equal(firstResponse.status, 201, 'publish')
  const first = await firstResponse.json()
  equal([first.version, first.note, first.snapshot], ['v1.0.0', 'first', created], 'immutable publication snapshot predates state update')
  const edited = await request(path, handler, 'PATCH', { ...graph, name: 'Edited' })
  equal(edited.status, 200, 'edit draft')
  equal((await edited.json()).status, '草稿', 'editable status')
  const second = await (await request(`${path}/publish`, handler, 'POST')).json()
  equal(second.version, 'v1.1.0', 'next version')
  equal((await request(`${path}/versions`)).status, 200, 'history readable')
  equal((await pool.query('SELECT snapshot FROM workflow_versions WHERE id=$1', [first.id])).rows[0].snapshot, first.snapshot, 'old snapshot unchanged')
  await pool.query("ALTER TABLE audit_events ADD CONSTRAINT synthetic_workflow_audit CHECK (action <> 'workflow.publish') NOT VALID")
  equal((await request(`${path}/publish`, handler, 'POST')).status, 503, 'audit failure refuses publication')
  equal((await pool.query('SELECT count(*)::int n FROM workflow_versions WHERE workflow_id=$1', [created.id])).rows[0].n, 2, 'audit failure no half-version')
  await pool.query('ALTER TABLE audit_events DROP CONSTRAINT synthetic_workflow_audit')
  equal((await request(path, handler, 'DELETE')).status, 204, 'soft delete')
  equal(await (await request('/api/workspaces/a/workflows')).json(), [], 'deleted omitted from list')
  equal((await request(`${path}/publish`, handler, 'POST')).status, 404, 'cannot publish deleted workflow')
  // Fixed identifiers are deliberately not UUIDs: normalization must never hide a wrong asset reference.
  const date = '2026-01-01T00:00:00Z'
  const dimensions = [{ id: 'quality', name: 'Quality', criteria: 'Synthetic criterion', weight: 100 }]
  const fixtures = {
    model_providers: [{ id: 'provider-a', workspace_id: 'a', name: 'Synthetic provider', provider_type: 'openai_compatible',
      base_url: 'https://model.example.invalid/v1', default_model: 'synthetic', secret_ref: 'SYNTHETIC_TEST_KEY', status: 'active', created_by: 'actor', created_at: date, updated_at: date }],
    agent_versions: ['a', 'b'].map(space => ({ id: `agent-version-${space}`, workspace_id: space, agent_id: `agent-${space}`, version: 'v1', snapshot: {}, note: '', created_at: date })),
    data_object_definitions: ['a', 'b'].map(space => ({ id: `object-${space}`, workspace_id: space, name: `Object ${space}`, description: '', schema: { type: 'object' }, status: 'published', version: 'v1', created_by: 'actor', created_at: date, updated_at: date })),
    data_object_versions: ['a', 'b'].map(space => ({ id: `object-version-${space}`, workspace_id: space, definition_id: `object-${space}`, version: 'v1', snapshot: { id: `object-${space}`, name: `Object ${space}`, schema: { type: 'object' } }, created_at: date })),
    rubrics: [{ id: 'rubric-a', workspace_id: 'a', name: 'Synthetic rubric', artifact: '', dimensions, gate: '', pass_score: 80, judge_type: 'llm', judge_model: 'synthetic', model_provider_id: 'provider-a', version: 'v1', status: 'active', sort_order: 0, created_at: date, updated_at: date }],
    rubric_versions: [{ id: 'rubric-version-a', workspace_id: 'a', rubric_id: 'rubric-a', version: 'v1', snapshot: { judgeType: 'llm', judgeModel: 'synthetic', modelProviderId: 'provider-a', dimensions }, created_at: date }],
  }
  for (const [table, rows] of Object.entries(fixtures)) for (const row of rows) {
    const keys = Object.keys(row)
    await pool.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, index) => `$${index + 1}`).join(',')})`,
      Object.values(row).map(value => typeof value === 'object' ? JSON.stringify(value) : value))
  }
  const referenceGraph = { ...graph, nodes: [graph.nodes[0],
    { id: 'agent', type: 'agent', position: { x: 50, y: 0 }, data: { agentId: 'agent-a', agentVersion: 'v1', outputDataObjectRef: { definitionId: 'object-a', version: 'v1' } } },
    { id: 'evaluation', type: 'evaluation', position: { x: 100, y: 0 }, data: { rubricRef: { rubricId: ' rubric-a ', versionId: ' rubric-version-a ', version: ' v1 ', name: ' Synthetic rubric ' } } },
    { id: 'human', type: 'human', position: { x: 150, y: 0 }, data: { assignmentType: 'direct_reviewer', reviewerIds: ['earlier'], reviewPolicy: 'threshold', requiredApprovals: ' 1 ', dueMinutes: '2_40', escalationMinutes: 480 } }, graph.nodes[1]],
    edges: [['start','agent'], ['agent','evaluation'], ['evaluation','human'], ['human','end']].map(([source,target]) => ({ id: `${source}-${target}`, source, target, data: { mappings: [{ sourcePath: '$', targetPath: '$.payload' }] } })) }
  const sharedCases = [
    { method: 'POST', path: '/workflows', body: { ...graph, name: ' Shared contract ', extra: true }, status: 201, saveAs: 'workflowId' },
    { method: 'GET', path: '/workflows/{workflowId}', status: 200 },
    { method: 'POST', path: '/workflows/{workflowId}/validate', status: 200 },
    { method: 'GET', path: '/workflows/{workflowId}/versions', status: 200 },
    { method: 'POST', path: '/workflows/{workflowId}/publish', body: { note: ' first ', ignored: true }, status: 201 },
    { method: 'PATCH', path: '/workflows/{workflowId}', body: { ...graph, name: 'Edited shared' }, status: 200 },
    { method: 'POST', path: '/workflows/{workflowId}/publish', status: 201 },
    { method: 'GET', path: '/workflows/{workflowId}/versions', status: 200 },
    ...[{}, { name: null }, { name: 'x', nodes: null }, { name: 'x', inputSchema: [] }, { name: 'x', edges: [{ id: 1 }] }]
      .map(body => ({ method: 'POST', path: '/workflows', body, status: 422 })),
    { method: 'PATCH', path: '/workflows/{workflowId}', body: { name: 'Invalid graph', nodes: [], edges: [] }, status: 200 },
    { method: 'POST', path: '/workflows/{workflowId}/validate', status: 200 },
    { method: 'POST', path: '/workflows/{workflowId}/publish', status: 422 },
    { method: 'DELETE', path: '/workflows/{workflowId}', status: 204 },
    { method: 'GET', path: '/workflows/{workflowId}/versions', status: 200 },
    { method: 'GET', path: '/reviewers', status: 200 },
    { method: 'GET', path: '/review-groups', status: 200 },
    { method: 'POST', path: '/workflows', body: referenceGraph, status: 201, saveAs: 'referenceId' },
    { method: 'POST', path: '/workflows/{referenceId}/validate', status: 200 },
    { method: 'POST', path: '/workflows/{referenceId}/publish', status: 201 },
    { method: 'GET', path: '/workflows/{referenceId}/versions', status: 200 },
    ...[null, {}, [null], [{ sourcePath: '', targetPath: null }]].flatMap(mappings => [
      { method: 'PATCH', path: '/workflows/{referenceId}', body: { ...graph, edges: [{ ...graph.edges[0], data: { mappings } }] }, status: 200 },
      { method: 'POST', path: '/workflows/{referenceId}/validate', status: 200 },
      { method: 'POST', path: '/workflows/{referenceId}/publish', status: 422 },
    ]),
    ...[
      { type: 'agent', data: { agentId: 'agent-b', agentVersion: 'v1', retryMaxAttempts: true } },
      { type: 'agent', data: { agentId: 'agent-a', agentVersion: 'v1', inputDataObjectRef: { definitionId: 'object-b', version: 'v1' } } },
      { type: 'human', data: { assignmentType: 'direct_reviewer', reviewerIds: ['foreign', 'later'], reviewPolicy: 'threshold', requiredApprovals: 2 } },
      { type: 'human', data: { assignmentType: 'round_robin', groupId: 'group-b' } },
      { type: 'human', data: { assignmentType: 'direct_reviewer', reviewerIds: ['foreign'], reviewPolicy: 'threshold', requiredApprovals: false, dueMinutes: null, escalationMinutes: [] } },
      { type: 'human', data: { assignmentType: ['direct'], reviewerIds: ['earlier'] } },
    ].flatMap(node => [
      { method: 'PATCH', path: '/workflows/{referenceId}', body: { ...graph, nodes: [graph.nodes[0], { id: 'middle', position: { x: 100, y: 0 }, ...node }, graph.nodes[1]] }, status: 200 },
      { method: 'POST', path: '/workflows/{referenceId}/validate', status: 200 },
      { method: 'POST', path: '/workflows/{referenceId}/publish', status: 422 },
    ]),
    { method: 'PATCH', path: '/workflows/{referenceId}', body: { ...referenceGraph, nodes: referenceGraph.nodes.map(node => node.type === 'human' ? { ...node, data: { ...node.data, requiredApprovals: '１', dueMinutes: '٢٤٠' } } : node) }, status: 200 },
    { method: 'POST', path: '/workflows/{referenceId}/validate', status: 200 },
  ]
  const sharedTables = {}
  for (const table of ['reviewers', 'review_groups', 'review_group_members', ...Object.keys(fixtures)]) sharedTables[table] = (await pool.query(`SELECT * FROM ${table}`)).rows
  const sharedResults = [], bindings = {}
  for (const item of sharedCases) {
    const resolved = item.path.replace(/\{(\w+)\}/g, (_, key) => bindings[key])
    const response = await request(`/api/workspaces/a${resolved}`, handler, item.method, item.body)
    equal(response.status, item.status, `shared ${item.method} ${item.path}`)
    const body = response.status === 204 ? null : await response.json()
    sharedResults.push({ status: response.status, body })
    if (item.saveAs) bindings[item.saveAs] = body.id
  }
  const replay = spawnSync(process.argv[3] ?? 'python', ['scripts/workflow-http-python.py'], {
    input: JSON.stringify({ tables: sharedTables, cases: sharedCases, foreignWorkspaces: ['b'] }), encoding: 'utf8', timeout: 60000,
  })
  assert.equal(replay.status, 0, replay.stderr || replay.stdout)
  const normalize = value => {
    if (Array.isArray(value)) return value.map(normalize)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, ['createdAt', 'updatedAt'].includes(key) ? '<timestamp>' : normalize(item)]))
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value) ? '<generated-id>' : value
  }
  const pythonResults = JSON.parse(replay.stdout)
  equal(pythonResults.length, sharedResults.length, 'shared response count')
  for (let index = 0; index < sharedResults.length; index++) equal(normalize(sharedResults[index]), normalize(pythonResults[index]), `complete Python/TS HTTP response ${index}`)
  const governancePath = `/api/workspaces/a/workflows/${bindings.referenceId}`
  // New independent test phase, not a production bypass: discard only this disposable schema's request counters.
  await pool.query('DELETE FROM identity_rate_limits')
  for (const role of ['viewer', 'operator', 'builder', 'workspace_admin']) {
    await pool.query("UPDATE workspace_memberships SET role=$1 WHERE id='member'", [role])
    for (const suffix of ['', '/versions', '/validate']) equal((await request(`${governancePath}${suffix}`, handler, suffix === '/validate' ? 'POST' : 'GET')).status, 200, `${role}: read governance ${suffix}`)
    const writable = ['builder', 'workspace_admin'].includes(role)
    const roleCreate = await request('/api/workspaces/a/workflows', handler, 'POST', graph)
    equal(roleCreate.status, writable ? 201 : 403, `${role}: create permission`)
    const rolePath = writable ? `/api/workspaces/a/workflows/${(await roleCreate.json()).id}` : governancePath
    for (const [method, suffix, body] of [['PATCH', '', graph], ['POST', '/publish'], ['DELETE', '']]) {
      equal((await request(`${rolePath}${suffix}`, handler, method, body)).status, writable ? method === 'PATCH' ? 200 : method === 'POST' ? 201 : 204 : 403, `${role}: ${method} ${suffix}`)
    }
  }
  for (const [method, suffix, body] of [['GET',''], ['GET','/versions'], ['POST','/validate'], ['PATCH','',graph], ['POST','/publish'], ['DELETE','']]) {
    equal((await request(governancePath.replace('/a/', '/b/') + suffix, handler, method, body)).status, 404, 'foreign scope governance denied')
  }
  for (const [method, target, body] of [['POST','/api/workspaces/a/workflows',graph], ['PATCH',governancePath,graph], ['POST',`${governancePath}/publish`], ['DELETE',governancePath]]) {
    const savedCsrf = csrf; csrf = ''
    equal((await request(target, handler, method, body)).status, 403, `${method}: missing CSRF denied`)
    csrf = savedCsrf
  }
  const versionRow = (await pool.query('SELECT * FROM workflow_versions WHERE workflow_id=$1', [bindings.referenceId])).rows[0]
  await pool.query("UPDATE workflow_versions SET snapshot='[]' WHERE id=$1", [versionRow.id])
  equal((await request(`${governancePath}/versions`)).status, 409, 'corrupt historical structure refused')
  await pool.query('UPDATE workflow_versions SET snapshot=$1 WHERE id=$2', [JSON.stringify(versionRow.snapshot), versionRow.id])
  for (const embedded of [[], { id: 'object-b', schema: {} }, { id: 'object-a', schema: [] }]) {
    const broken = structuredClone(versionRow.snapshot)
    broken.nodes.find(node => node.id === 'agent').data.outputDataObjectRef.snapshot = embedded
    await pool.query('UPDATE workflow_versions SET snapshot=$1 WHERE id=$2', [JSON.stringify(broken), versionRow.id])
    equal((await request(`${governancePath}/versions`)).status, 409, 'damaged embedded historical object refused')
  }
  await pool.query('UPDATE workflow_versions SET snapshot=$1 WHERE id=$2', [JSON.stringify(versionRow.snapshot), versionRow.id])
  await pool.query("UPDATE agent_versions SET workspace_id='b' WHERE id='agent-version-a'")
  equal((await request(`${governancePath}/versions`)).status, 409, 'historical reference outside workspace refused')
  await pool.query("UPDATE agent_versions SET workspace_id='a' WHERE id='agent-version-a'")
  equal((await request(`${governancePath}/versions`)).status, 200, 'restored synthetic history readable')
  equal((await request(governancePath, handler, 'PATCH', referenceGraph)).status, 200, 'restore valid draft before corrupt dependency checks')
  const goodObject = fixtures.data_object_versions[0].snapshot
  for (const snapshot of [[], { ...goodObject, id: 'object-b' }, { ...goodObject, schema: [] }, { id: 'object-a' }]) {
    await pool.query('UPDATE data_object_versions SET snapshot=$1 WHERE id=$2', [JSON.stringify(snapshot), 'object-version-a'])
    equal((await request(`${governancePath}/publish`, handler, 'POST')).status, 409, 'damaged dependency snapshot rejected before commit')
    equal((await pool.query('SELECT count(*)::int n FROM workflow_versions WHERE workflow_id=$1', [bindings.referenceId])).rows[0].n, 1, 'damaged dependency leaves no extra publication')
  }
  await pool.query('UPDATE data_object_versions SET snapshot=$1 WHERE id=$2', [JSON.stringify(goodObject), 'object-version-a'])
  await pool.query("UPDATE workflow_versions SET version='v1.1.0' WHERE id=$1", [versionRow.id])
  equal((await request(`${governancePath}/publish`, handler, 'POST')).status, 409, 'legacy noncontiguous version candidate collision')
  await pool.query('UPDATE workflow_versions SET version=$1 WHERE id=$2', [versionRow.version, versionRow.id])
  equal((await pool.query('SELECT count(*)::int n FROM workflow_runs')).rows[0].n, 0, 'full governance never runs workflows')
  equal((await pool.query('SELECT count(*)::int n FROM human_tasks')).rows[0].n, 0, 'full governance never dispatches human tasks')
  await pool.query("UPDATE workspace_memberships SET status='disabled' WHERE id='member'")
  equal((await request('/api/workspaces/a/reviewers')).status, 404, 'revoked membership denied')
  console.log(JSON.stringify({ checks, sharedRequests: sharedCases.length, scope: 'Workflow lifecycle and read-only directories' }))
} finally {
  await pool.end()
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
  assert.equal((await admin.query('SELECT nspname FROM pg_namespace WHERE nspname=$1', [schema])).rows.length, 0)
  await admin.end()
  console.log('Synthetic workflow schema cleanup independently verified')
}
