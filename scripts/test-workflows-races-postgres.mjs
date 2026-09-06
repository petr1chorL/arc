// Deterministic HTTP/SQL competition in one disposable loopback schema.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { createIdentityWorkspaceHandler } from '../netlify/functions/_shared/identity-workspace/handler.ts'
import { createPostgresIdentityWorkspaceBackend } from '../netlify/functions/_shared/identity-workspace/postgres.ts'
import { hashPassword } from '../netlify/functions/_shared/identity-workspace/security.ts'
import { createWorkflowsHandler } from '../netlify/functions/_shared/workflows/handler.ts'
import { createPostgresWorkflowsBackend } from '../netlify/functions/_shared/workflows/postgres.ts'

const { Pool } = createRequire(import.meta.resolve('@netlify/database'))('pg')
const port = process.argv[2] ?? '5432'
assert(/^[0-9]{1,5}$/.test(port) && Number(port) > 0 && Number(port) < 65536)
const connection = { host: '127.0.0.1', port: Number(port), user: 'postgres', database: 'arc_identity_test', connectionTimeoutMillis: 5000, statement_timeout: 10000 }
const schema = `workflow_races_${randomUUID().replaceAll('-', '')}`
const admin = new Pool(connection)
const pool = new Pool({ ...connection, options: `-c search_path=${schema}` })
const identity = createIdentityWorkspaceHandler(createPostgresIdentityWorkspaceBackend(pool))
const handler = createWorkflowsHandler(createPostgresWorkflowsBackend(pool))
const base = '/api/workspaces/a/workflows'
let checks = 0, races = 0
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++ }
const accounts = []
function request(path, method = 'GET', body, selected = handler, account = accounts[0]) {
  return selected(new Request(`https://synthetic.invalid${path}`, { method,
    headers: { Cookie: account?.cookie ?? '', 'X-CSRF-Token': account?.csrf ?? '' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
}
const node = (id, type, data = {}) => ({ id, type, position: { x: 0, y: 0 }, data })
function graph(name, middle) {
  const nodes = [node('start', 'trigger'), ...(middle ? [middle] : []), node('end', 'end')]
  return { name, nodes, edges: nodes.slice(1).map((item, index) => ({ id: `e${index}`, source: nodes[index].id, target: item.id })) }
}
async function create(body) {
  const response = await request(base, 'POST', body)
  equal(response.status, 201, 'create synthetic workflow')
  return response.json()
}
async function bounded(promise, label) {
  const abort = new AbortController()
  try { return await Promise.race([promise, delay(5000, null, { signal: abort.signal }).then(() => { throw new Error(label) })]) }
  finally { abort.abort() }
}

/** Pause after dependency locks, then prove the other backend is waiting on this publisher. */
async function race(workflow, competitor, label) {
  let resume, ready, publisherPid, peerPid
  const released = new Promise(resolve => { resume = resolve })
  const reached = new Promise(resolve => { ready = resolve })
  const wrap = gated => ({
    async connect() {
      const client = await pool.connect()
      const pid = (await client.query('SELECT pg_backend_pid() pid')).rows[0].pid
      if (gated) publisherPid = pid
      else peerPid = pid
      return {
        async query(sql, values) {
          if (gated && sql.includes('count(*)') && sql.includes('FROM workflow_versions')) {
            ready()
            await released
          }
          return client.query(sql, values)
        },
        release() { client.release() },
      }
    },
  })
  const publisher = createWorkflowsHandler(createPostgresWorkflowsBackend(wrap(true)))
  const peer = createWorkflowsHandler(createPostgresWorkflowsBackend(wrap(false)))
  const publishing = request(`${base}/${workflow.id}/publish`, 'POST', undefined, publisher)
  let competing, sqlClient
  try {
    await bounded(Promise.race([reached, publishing.then(response => { throw new Error(`Publisher ended before gate: ${response.status}`) })]), `${label}: publisher gate timeout`)
    if (competitor.sql) {
      sqlClient = await admin.connect()
      peerPid = (await sqlClient.query('SELECT pg_backend_pid() pid')).rows[0].pid
      competing = sqlClient.query(competitor.sql, competitor.values)
    } else competing = request(`${base}/${workflow.id}${competitor.suffix ?? ''}`, competitor.method, competitor.body, peer, accounts[1])
    let blocked = false
    const deadline = Date.now() + 4000
    while (Date.now() < deadline && !blocked) {
      if (peerPid) blocked = (await admin.query('SELECT pg_blocking_pids($1) pids', [peerPid])).rows[0].pids.includes(publisherPid)
      if (!blocked) await delay(20)
    }
    equal(blocked, true, `${label}: actual publisher lock blocks competitor`)
    resume()
    const first = await publishing
    equal(first.status, 201, `${label}: publisher commits`)
    const second = await competing
    races++
    return [await first.json(), second]
  } finally {
    resume()
    await Promise.allSettled([publishing, ...(competing ? [competing] : [])])
    sqlClient?.release()
  }
}

try {
  await admin.query(`CREATE SCHEMA ${schema}`)
  for (const name of ['20260904060000_create-arc-one-baseline', '20260904133000_create-identity-rate-limits']) {
    await pool.query(readFileSync(new URL(`../netlify/database/migrations/${name}/migration.sql`, import.meta.url), 'utf8'))
  }
  await pool.query("INSERT INTO organizations VALUES ('org','Synthetic','synthetic','active',now(),now())")
  await pool.query("INSERT INTO workspaces (id,organization_id,name,slug,status,created_at,updated_at) VALUES ('a','org','Synthetic','a','active',now(),now())")
  const password = `Synthetic-${randomUUID()}!`
  await pool.query(`INSERT INTO users (id,organization_id,email,normalized_email,display_name,password_hash,status,is_organization_admin,failed_login_count,created_at,updated_at)
    VALUES ('actor','org','actor@example.invalid','actor@example.invalid','Synthetic',$1,'active',false,0,now(),now())`, [await hashPassword(password)])
  await pool.query("INSERT INTO workspace_memberships (id,workspace_id,user_id,role,status,created_at,updated_at) VALUES ('member','a','actor','workspace_admin','active',now(),now())")
  for (let index = 0; index < 2; index++) {
    const response = await request('/api/auth/login', 'POST', { email: 'actor@example.invalid', password }, identity)
    equal(response.status, 200, 'independent login')
    const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    accounts.push({ cookie, csrf: decodeURIComponent(cookie.match(/arc_one_csrf=([^;]+)/)[1]) })
  }
  equal(accounts[0].cookie === accounts[1].cookie, false, 'distinct sessions do not serialize on session row')
  const concurrent = await create(graph('Concurrent publication'))
  const [first, secondResponse] = await race(concurrent, { method: 'POST', suffix: '/publish' }, 'publish/publish')
  equal(secondResponse.status, 201, 'second publisher succeeds')
  const second = await secondResponse.json()
  equal([first.version, second.version], ['v1.0.0', 'v1.1.0'], 'locked counter allocates distinct versions')
  equal((await admin.query(`SELECT version,snapshot FROM ${schema}.workflow_versions WHERE workflow_id=$1 ORDER BY version`, [concurrent.id])).rows,
    [{ version: first.version, snapshot: first.snapshot }, { version: second.version, snapshot: second.snapshot }], 'independently persisted versions')
  for (const method of ['PATCH', 'DELETE']) {
    const draft = await create(graph(`Publish versus ${method}`))
    const [published, response] = await race(draft, { method, ...(method === 'PATCH' ? { body: graph('Edited after publication') } : {}) }, `publish/${method}`)
    equal(response.status, method === 'PATCH' ? 200 : 204, 'waiting mutation completes')
    const stored = (await admin.query(`SELECT name,status FROM ${schema}.workflows WHERE id=$1`, [draft.id])).rows[0]
    equal(stored, { name: method === 'PATCH' ? 'Edited after publication' : draft.name, status: method === 'PATCH' ? '草稿' : '已删除' }, 'mutation follows publication')
    equal((await admin.query(`SELECT snapshot FROM ${schema}.workflow_versions WHERE id=$1`, [published.id])).rows[0].snapshot,
      draft, 'later mutation preserves original snapshot')
    if (method === 'DELETE') equal((await request(`${base}/${draft.id}/publish`, 'POST')).status, 404, 'deleted workflow cannot republish')
  }

  // Exact source-controlled IDs and tables; invalidations emulate independent dependency management writers.
  await pool.query(`INSERT INTO agents (id,workspace_id,name,role,owner,model,model_provider_id,model_provider,model_base_url,
    temperature,max_output_tokens,status,version,pass_rate,runs,tools,skills,tool_asset_refs,skill_asset_refs,system_prompt,runtime_manifest,created_at,updated_at)
    VALUES ('agent','a','Synthetic Agent','Test','Test','synthetic',NULL,'openai-compatible','',0.2,2000,'在线','v1.0.0',0,0,'[]','[]','[]','[]','','{}',now(),now())`)
  await pool.query("INSERT INTO agent_versions VALUES ('av','a','agent','v1.0.0','{}','',now())")
  await pool.query(`INSERT INTO data_object_definitions VALUES ('definition','a','Synthetic definition','','{}','published','v1.0.0','actor',now(),now())`)
  await pool.query(`INSERT INTO data_object_versions VALUES ('dv','a','definition','v1.0.0',$1,now())`, [JSON.stringify({ id: 'definition', schema: {} })])
  await pool.query(`INSERT INTO model_providers (id,workspace_id,name,provider_type,base_url,default_model,secret_ref,status,created_by,created_at,updated_at)
    VALUES ('provider','a','Synthetic provider','openai-compatible','https://models.example.invalid','synthetic','SYNTHETIC_KEY','active','actor',now(),now())`)
  const dimensions = [{ id: 'quality', name: 'Quality', criteria: 'Synthetic', weight: 100 }]
  await pool.query(`INSERT INTO rubrics VALUES ('rubric','a','Synthetic rubric','artifact',$1,'',80,'llm','synthetic','provider','v1.0.0','active',1,now(),now())`, [JSON.stringify(dimensions)])
  await pool.query(`INSERT INTO rubric_versions VALUES ('rv','a','rubric','v1.0.0',$1,now())`, [JSON.stringify({ judgeType: 'llm', judgeModel: 'synthetic', modelProviderId: 'provider', dimensions })])
  const dependencies = [
    { label: 'AgentVersion update', middle: node('task', 'agent', { agentId: 'agent', agentVersion: 'v1.0.0' }), sql: `UPDATE ${schema}.agent_versions SET version='v9.0.0' WHERE id='av'` },
    { label: 'DataObject disable', middle: node('contract', 'transform', { inputDataObjectRef: { definitionId: 'definition', version: 'v1.0.0' } }), sql: `UPDATE ${schema}.data_object_definitions SET status='disabled' WHERE id='definition'` },
    { label: 'Provider disable', middle: node('judge', 'evaluation', { rubricRef: { rubricId: 'rubric', versionId: 'rv', version: 'v1.0.0', name: 'Synthetic rubric' } }), sql: `UPDATE ${schema}.model_providers SET status='disabled' WHERE id='provider'` },
  ]
  for (const dependency of dependencies) {
    const draft = await create(graph(dependency.label, dependency.middle))
    const [published] = await race(draft, dependency, dependency.label)
    equal((await request(`${base}/${draft.id}/publish`, 'POST')).status, 422, `${dependency.label}: subsequent publication rejected`)
    const rows = (await admin.query(`SELECT snapshot FROM ${schema}.workflow_versions WHERE workflow_id=$1`, [draft.id])).rows
    equal(rows, [{ snapshot: published.snapshot }], `${dependency.label}: no partial version after rejection`)
  }
  const rollback = await create(graph('Audit rollback'))
  for (const [operation, method] of [['update', 'PATCH'], ['delete', 'DELETE']]) {
    const before = (await admin.query(`SELECT * FROM ${schema}.workflows WHERE id=$1`, [rollback.id])).rows[0]
    const auditBefore = (await admin.query(`SELECT count(*)::int n FROM ${schema}.audit_events WHERE target_id=$1`, [rollback.id])).rows[0].n
    await pool.query(`ALTER TABLE audit_events ADD CONSTRAINT synthetic_workflow_failure CHECK (action <> 'workflow.${operation}') NOT VALID`)
    try {
      equal((await request(`${base}/${rollback.id}`, method, method === 'PATCH' ? graph('Must roll back') : undefined)).status, 503, `${operation}: audit failure rejects write`)
      equal((await admin.query(`SELECT * FROM ${schema}.workflows WHERE id=$1`, [rollback.id])).rows[0], before, `${operation}: all fields including timestamp unchanged`)
      equal((await admin.query(`SELECT count(*)::int n FROM ${schema}.audit_events WHERE target_id=$1`, [rollback.id])).rows[0].n, auditBefore, `${operation}: no success audit`)
    } finally { await pool.query('ALTER TABLE audit_events DROP CONSTRAINT synthetic_workflow_failure') }
  }
  console.log(JSON.stringify({ passed: true, checks, observedLockRaces: races, scope: 'Synthetic workflow HTTP races and SQL dependency writers' }))
} finally {
  await pool.end()
  try {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    assert.equal((await admin.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [schema])).rowCount, 0)
    console.log('Synthetic workflow race schema cleanup independently verified')
  } finally { await admin.end() }
}
