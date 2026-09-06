// Fixed loopback database and independently checked random-schema cleanup; no credentials.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { createIdentityWorkspaceHandler } from '../netlify/functions/_shared/identity-workspace/handler.ts'
import { createPostgresIdentityWorkspaceBackend } from '../netlify/functions/_shared/identity-workspace/postgres.ts'
import { hashPassword } from '../netlify/functions/_shared/identity-workspace/security.ts'
import { createRubricsHandler } from '../netlify/functions/_shared/rubrics/handler.ts'
import { createPostgresRubricsBackend } from '../netlify/functions/_shared/rubrics/postgres.ts'
import { createReferenceAssetsHandler } from '../netlify/functions/_shared/reference-assets/handler.ts'
import { createPostgresReferenceAssetsBackend } from '../netlify/functions/_shared/reference-assets/postgres.ts'

const { Pool } = createRequire(import.meta.resolve('@netlify/database'))('pg')
const port = process.argv[2] ?? '5432'
if (!/^[0-9]{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid local test port')
const connectionString = `postgresql://postgres@127.0.0.1:${port}/arc_identity_test`
const schema = `rubrics_test_${randomUUID().replaceAll('-', '')}`
const admin = new Pool({ connectionString, connectionTimeoutMillis: 5000 })
const pool = new Pool({ connectionString, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000,
  statement_timeout: 10000, max: 4 })
let checks = 0
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++ }
const identity = createIdentityWorkspaceHandler(createPostgresIdentityWorkspaceBackend(pool))
const handler = createRubricsHandler(createPostgresRubricsBackend(pool))
let cookie = '', csrf = ''
const base = '/api/workspaces/a/evaluations/rubrics'
function request(path, method = 'GET', body, token = csrf, selected = handler) {
  return selected(new Request(`https://synthetic.invalid${path}`, { method,
    headers: { Cookie: cookie, 'X-CSRF-Token': token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
}
try {
  await admin.query(`CREATE SCHEMA ${schema}`)
  for (const name of ['20260904060000_create-arc-one-baseline', '20260904133000_create-identity-rate-limits']) {
    await pool.query(readFileSync(new URL(`../netlify/database/migrations/${name}/migration.sql`, import.meta.url), 'utf8'))
  }
  const now = new Date()
  await pool.query(`INSERT INTO organizations VALUES ('org','Synthetic','synthetic','active',$1,$1)`, [now])
  for (const id of ['a', 'b']) await pool.query(`INSERT INTO workspaces
    (id,organization_id,name,slug,status,created_at,updated_at) VALUES ($1,'org',$1,$1,'active',$2,$2)`, [id, now])
  const password = `Synthetic-${randomUUID()}!`
  await pool.query(`INSERT INTO users
    (id,organization_id,email,normalized_email,display_name,password_hash,status,is_organization_admin,
     failed_login_count,created_at,updated_at)
    VALUES ('actor','org','actor@example.invalid','actor@example.invalid','Synthetic',$1,'active',false,0,$2,$2)`,
  [await hashPassword(password), now])
  for (const id of ['a', 'b']) await pool.query(`INSERT INTO workspace_memberships
    (id,workspace_id,user_id,role,status,created_at,updated_at)
    VALUES ($1,$1,'actor','builder','active',$2,$2)`, [id, now])
  equal((await request(base)).status, 401, 'anonymous denied')
  const login = await request('/api/auth/login', 'POST', { email: 'actor@example.invalid', password }, '', identity)
  equal(login.status, 200, 'same-database login')
  cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  csrf = decodeURIComponent(cookie.match(/arc_one_csrf=([^;]+)/)[1])
  const data = { name: 'Synthetic rubric', artifact: 'Report', gate: 'Required', passScore: 80,
    dimensions: [{ name: 'Quality', weight: 100, criteria: 'Grounded' }] }
  equal((await request(base, 'POST', data, '')).status, 403, 'CSRF required')
  const created = await request(base, 'POST', data)
  equal(created.status, 201, 'create')
  const rubric = await created.json()
  equal([rubric.name, rubric.status, rubric.version, rubric.judgeType, rubric.judgeModel],
    ['Synthetic rubric', 'draft', 'v0.1.0', 'deterministic', ''], 'create defaults')
  assert.match(rubric.dimensions[0].id, /^[0-9a-f-]{36}$/)
  equal(Object.hasOwn(rubric, 'modelProviderId'), false, 'omit null provider')
  equal(await (await request(base)).json(), [rubric], 'same database persisted list')
  equal((await pool.query('SELECT name,pass_score,sort_order FROM rubrics WHERE id=$1', [rubric.id])).rows,
    [{ name: 'Synthetic rubric', pass_score: 80, sort_order: 1 }], 'independent persisted fields')
  equal((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='evaluation.rubric.create' AND outcome='success'")).rows[0].n, 1, 'same transaction success audit')
  equal((await request(base, 'POST', { ...data, dimensions: [] })).status, 422, 'invalid dimensions')
  equal((await pool.query('SELECT count(*)::int AS n FROM rubrics')).rows[0].n, 1, 'invalid request has no write')
  equal((await request(base, 'POST', { ...data, name: 'Foreign provider', modelProviderId: 'missing' })).status, 422, 'missing provider')
  equal((await pool.query('SELECT count(*)::int AS n FROM rubrics')).rows[0].n, 1, 'missing provider has no write')
  const path = `${base}/${rubric.id}`
  const emptyHistory = await request(`${path}/versions`)
  equal(emptyHistory.status, 200, 'history route')
  equal(await emptyHistory.json(), [], 'empty version history')
  equal((await request(`/api/workspaces/b/evaluations/rubrics/${rubric.id}/versions`)).status, 404, 'foreign rubric history denied')
  equal((await request(`${base}/missing/versions`)).status, 404, 'missing rubric history')
  equal((await request(path, 'PATCH', { name: 'Partial' })).status, 422, 'PATCH requires complete write body')
  equal(await (await request(base)).json(), [rubric], 'partial PATCH leaves persisted row unchanged')
  const replacement = { ...data, name: 'Replaced rubric', dimensions: rubric.dimensions }
  const updatedResponse = await request(path, 'PATCH', replacement)
  equal(updatedResponse.status, 200, 'full replacement')
  const updated = await updatedResponse.json()
  equal(updated.name, 'Replaced rubric', 'updated response')
  const publishedResponse = await request(`${path}/publish`, 'POST')
  equal(publishedResponse.status, 201, 'first publication')
  const published = await publishedResponse.json()
  equal(published.snapshot, { ...updated, status: 'active', version: 'v1.0.0' }, 'snapshot captures new active state')
  const storedSnapshot = (await pool.query('SELECT snapshot FROM rubric_versions WHERE id=$1', [published.id])).rows[0].snapshot
  equal(storedSnapshot.pass_score, 80, 'snapshot stored in Python snake_case')
  equal(Object.hasOwn(storedSnapshot, 'passScore'), false, 'do not store transport aliases')
  equal((await request(path, 'PATCH', { ...replacement, passScore: 95 })).status, 200, 'edit after publication')
  equal(await (await request(`${path}/versions`)).json(), [published], 'old snapshot immutable after edit')
  const second = await (await request(`${path}/publish`, 'POST')).json()
  equal(second.version, 'v1.1.0', 'next counted version')
  equal(second.snapshot.passScore, 95, 'second snapshot uses edited fields')
  equal((await request(`${path}/deactivate`, 'POST')).status, 403, 'builder cannot deactivate')
  await pool.query("UPDATE workspace_memberships SET role='workspace_admin' WHERE id='a'")
  const disabledResponse = await request(`${path}/deactivate`, 'POST')
  equal(disabledResponse.status, 200, 'deactivate')
  equal((await disabledResponse.json()).status, 'disabled', 'disabled response')
  equal((await request(path, 'PATCH', replacement)).status, 409, 'disabled edit denied')
  equal((await request(`${path}/publish`, 'POST')).status, 409, 'disabled publish denied')
  equal(await (await request(`${path}/versions`)).json(), [second, published], 'history remains immutable and descending')
  equal((await request(`/api/workspaces/b/evaluations/rubrics/${rubric.id}`, 'PATCH', replacement)).status, 404, 'foreign mutation denied')
  const defaultsResponse = await request('/api/workspaces/b/evaluations/rubrics')
  equal(defaultsResponse.status, 200, 'empty workspace seeds defaults')
  const defaults = await defaultsResponse.json()
  equal(defaults.map(item => [item.name, item.version, item.passScore]), [
    ['竞品分析质量标准', 'v2.1', 85], ['需求洞察质量标准', 'v1.6', 80], ['产品定义准入标准', 'v0.9', 88],
  ], 'baseline default values')
  equal(await (await request('/api/workspaces/b/evaluations/rubrics')).json(), defaults, 'default rows stable on reread')
  equal((await pool.query("SELECT count(*)::int AS n FROM rubrics WHERE workspace_id='b'")).rows[0].n, 3, 'exactly three persisted defaults')
  await pool.query(`CREATE FUNCTION fail_rubric_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='evaluation.rubric.create' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$`)
  await pool.query('CREATE TRIGGER fail_rubric_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_rubric_audit()')
  equal((await request(base, 'POST', { ...data, name: 'Rollback rubric' })).status, 503, 'audit failure is unavailable, not success')
  equal((await pool.query("SELECT count(*)::int AS n FROM rubrics WHERE name='Rollback rubric'")).rows[0].n, 0, 'audit failure rolls back rubric')
  await pool.query('DROP TRIGGER fail_rubric_audit ON audit_events')
  const otherLogin = await request('/api/auth/login', 'POST', { email: 'actor@example.invalid', password }, '', identity)
  equal(otherLogin.status, 200, 'second independent login')
  const otherCookie = otherLogin.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  assert.notEqual(otherCookie, cookie)
  await verifySeedRace(otherCookie)
  const providerId = await verifySharedHttp()
  await verifyPublicationRace(otherCookie, providerId)
  await verifyMutationRollback()
  await verifyRoleMatrix()
  await verifyHistoricalReadGuard()
  await pool.query("UPDATE workspace_memberships SET role='viewer' WHERE id='a'")
  equal((await request(base)).status, 200, 'viewer reads')
  equal((await request(base, 'POST', { ...data, name: 'Denied' })).status, 403, 'viewer cannot create')
  console.log(`Rubric PostgreSQL governance: ${checks} checks passed`)
} finally {
  await pool.end()
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
  equal((await admin.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [schema])).rows.length, 0, 'schema cleanup')
  await admin.end()
  console.log('Synthetic rubric schema cleanup independently confirmed')
}

async function verifyRoleMatrix() {
  for (const role of ['viewer', 'operator', 'builder', 'workspace_admin']) {
    await pool.query("UPDATE workspace_memberships SET role='workspace_admin' WHERE id='a'")
    const data = { name: `Matrix ${role}`, artifact: 'Report', gate: 'Required', passScore: 80,
      dimensions: [{ id: 'quality', name: 'Quality', weight: 100, criteria: 'Grounded' }] }
    const row = await (await request(base, 'POST', data)).json()
    await pool.query('UPDATE workspace_memberships SET role=$1 WHERE id=$2', [role, 'a'])
    const allowed = ['builder', 'workspace_admin'].includes(role)
    const path = `${base}/${row.id}`
    const routes = [
      ['GET', base, undefined, 200], ['POST', base, { ...data, name: `Matrix created ${role}` }, allowed ? 201 : 403],
      ['PATCH', path, data, allowed ? 200 : 403], ['GET', `${path}/versions`, undefined, 200],
      ['POST', `${path}/publish`, undefined, allowed ? 201 : 403],
      ['POST', `${path}/deactivate`, undefined, role === 'workspace_admin' ? 200 : 403],
    ]
    for (const [method, url, body, status] of routes) {
      if (method !== 'GET') equal((await request(url, method, body, '')).status, 403, `${role} ${method}: CSRF always required`)
      equal((await request(url, method, body)).status, status, `${role} ${method} ${url}`)
    }
    if (!allowed) {
      equal((await pool.query('SELECT status,version FROM rubrics WHERE id=$1', [row.id])).rows[0],
        { status: 'draft', version: 'v0.1.0' }, `${role}: mutations did not persist`)
      equal((await pool.query('SELECT count(*)::int AS n FROM rubric_versions WHERE rubric_id=$1', [row.id])).rows[0].n, 0, `${role}: no unauthorized version`)
    }
  }
}

async function verifyHistoricalReadGuard() {
  const data = { name: 'Historical guard', artifact: 'Report', gate: 'Required', passScore: 80,
    dimensions: [{ id: 'quality', name: 'Quality', weight: 100, criteria: 'Grounded' }] }
  const rubric = await (await request(base, 'POST', data)).json()
  const version = await (await request(`${base}/${rubric.id}/publish`, 'POST')).json()
  const original = (await pool.query('SELECT snapshot FROM rubric_versions WHERE id=$1', [version.id])).rows[0].snapshot
  try {
    for (const malformed of [null, [], { ...original, dimensions: null }, { ...original, judge_type: 'unknown' }]) {
      await pool.query('UPDATE rubric_versions SET snapshot=$1 WHERE id=$2', [JSON.stringify(malformed), version.id])
      const response = await request(`${base}/${rubric.id}/versions`)
      equal(response.status, 409, 'corrupt historical snapshot rejected')
      equal(await response.json(), { detail: '历史评分量规结构不符合要求，需先完成治理' }, 'fixed historical error')
      equal((await pool.query('SELECT snapshot FROM rubric_versions WHERE id=$1', [version.id])).rows[0].snapshot, malformed, 'corruption not rewritten')
    }
  } finally {
    await pool.query('UPDATE rubric_versions SET snapshot=$1 WHERE id=$2', [JSON.stringify(original), version.id])
  }
  try {
    await pool.query('UPDATE rubrics SET dimensions=$1 WHERE id=$2', ['null', rubric.id])
    equal((await request(base)).status, 409, 'corrupt current row blocks unsafe list')
    equal((await pool.query('SELECT dimensions FROM rubrics WHERE id=$1', [rubric.id])).rows[0].dimensions, null, 'current corruption not rewritten')
  } finally {
    await pool.query('UPDATE rubrics SET dimensions=$1 WHERE id=$2', [JSON.stringify(data.dimensions), rubric.id])
  }
}

async function verifySharedHttp() {
  const cases = JSON.parse(readFileSync(new URL('../fixtures/rubric-http.json', import.meta.url), 'utf8'))
  const python = spawnSync(process.argv[3] ?? 'python', ['scripts/rubric-http-python.py'], {
    input: JSON.stringify(cases), encoding: 'utf8', timeout: 30000,
  })
  equal(python.status, 0, python.stderr)
  const providers = createReferenceAssetsHandler(createPostgresReferenceAssetsBackend(pool))
  const provider = await request('/api/workspaces/a/model-providers', 'POST', { name: 'Shared rubric provider',
    baseUrl: 'https://model.example.invalid', defaultModel: 'synthetic', secretRef: 'SYNTHETIC_KEY' }, csrf, providers)
  equal(provider.status, 201, 'shared provider created')
  const providerId = (await provider.json()).id
  const resolve = value => Array.isArray(value) ? value.map(resolve)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item)]))
      : value === '@provider' ? providerId : value
  const actual = []
  for (const test of cases) {
    const response = await request(base, 'POST', resolve(test.body))
    equal(response.status, test.status, test.name)
    const result = { status: response.status, body: await response.json(), steps: [] }
    for (const step of test.steps ?? []) {
      const follow = await request(`${base}/${result.body.id}${step.suffix}`, step.method, step.body === undefined ? undefined : resolve(step.body))
      equal(follow.status, step.status, `${test.name} ${step.method} ${step.suffix}`)
      result.steps.push({ status: follow.status, body: await follow.json() })
    }
    actual.push(result)
  }
  equal(normalizeResponses(actual), normalizeResponses(JSON.parse(python.stdout)), 'complete Python/TS HTTP response contract')
  return providerId
}

async function verifyMutationRollback() {
  const data = { name: 'Mutation rollback', artifact: 'Report', gate: 'Required', passScore: 80,
    dimensions: [{ id: 'quality', name: 'Quality', weight: 100, criteria: 'Grounded' }] }
  const created = await (await request(base, 'POST', data)).json()
  const original = (await pool.query('SELECT * FROM rubrics WHERE id=$1', [created.id])).rows[0]
  const auditBefore = (await pool.query('SELECT count(*)::int AS n FROM audit_events WHERE target_id=$1', [created.id])).rows[0].n
  await pool.query(`CREATE OR REPLACE FUNCTION fail_rubric_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action LIKE 'evaluation.rubric.%' AND NEW.outcome='success' THEN RAISE EXCEPTION 'Synthetic mutation audit failure'; END IF; RETURN NEW; END $$`)
  await pool.query('CREATE TRIGGER fail_rubric_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_rubric_audit()')
  try {
    for (const [method, suffix, body] of [['PATCH', '', { ...data, passScore: 95 }], ['POST', '/publish'], ['POST', '/deactivate']]) {
      equal((await request(`${base}/${created.id}${suffix}`, method, body)).status, 503, `${suffix || 'edit'} audit failure`)
      equal((await pool.query('SELECT * FROM rubrics WHERE id=$1', [created.id])).rows[0], original, 'failed mutation leaves all row fields unchanged')
      equal((await pool.query('SELECT count(*)::int AS n FROM rubric_versions WHERE rubric_id=$1', [created.id])).rows[0].n, 0, 'failed mutation leaves no version')
      equal((await pool.query('SELECT count(*)::int AS n FROM audit_events WHERE target_id=$1', [created.id])).rows[0].n, auditBefore, 'failed mutation leaves no success audit')
    }
  } finally {
    await pool.query('DROP TRIGGER fail_rubric_audit ON audit_events')
  }
  await pool.query('INSERT INTO rubric_versions (id,workspace_id,rubric_id,version,snapshot,created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [randomUUID(), 'a', created.id, 'v1.1.0', JSON.stringify(original), new Date()])
  equal((await request(`${base}/${created.id}/publish`, 'POST')).status, 409, 'historical candidate version collision')
  equal((await pool.query('SELECT * FROM rubrics WHERE id=$1', [created.id])).rows[0], original, 'version conflict does not activate draft')
  equal((await pool.query('SELECT count(*)::int AS n FROM rubric_versions WHERE rubric_id=$1', [created.id])).rows[0].n, 1, 'version conflict does not insert')
}

async function verifyPublicationRace(otherCookie, providerId) {
  const created = await (await request(base, 'POST', { name: 'Concurrent rubric', artifact: 'Report', gate: 'Required', passScore: 80,
    judgeType: 'llm', judgeModel: 'synthetic', modelProviderId: providerId,
    dimensions: [{ id: 'quality', name: 'Quality', weight: 100, criteria: 'Grounded' }] })).json()
  let unlock, ready, attempt
  const released = new Promise(resolve => { unlock = resolve })
  const locked = new Promise(resolve => { ready = resolve })
  const attempted = new Promise(resolve => { attempt = resolve })
  const pids = []
  const racing = createRubricsHandler(createPostgresRubricsBackend(observeQueries(async (client, statement, values) => {
    if (statement === 'SELECT * FROM rubrics WHERE workspace_id=$1 AND id=$2 FOR UPDATE' && values[1] === created.id) {
      const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
      const first = pids.length === 0
      pids.push(pid)
      if (!first) attempt()
      const result = await client.query(statement, values)
      if (first) { ready(); await released }
      return result
    }
    return client.query(statement, values)
  })))
  const pending = []
  try {
    pending.push(request(`${base}/${created.id}/publish`, 'POST', undefined, csrf, racing))
    await bounded(locked, 'first publication row lock')
    pending.push(racing(new Request(`https://synthetic.invalid${base}/${created.id}/publish`, { method: 'POST',
      headers: { Cookie: otherCookie, 'X-CSRF-Token': decodeURIComponent(otherCookie.match(/arc_one_csrf=([^;]+)/)[1]) } })))
    await bounded(attempted, 'second publication row lock attempted')
    await assertBlocked(pids[0], pids[1], 'actual publication row blocking')
  } finally {
    unlock()
    await Promise.allSettled(pending)
  }
  const responses = await Promise.all(pending)
  equal(responses.map(item => item.status), [201, 201], 'both independent publications succeed')
  const versions = await Promise.all(responses.map(item => item.json()))
  equal(versions.map(item => item.version), ['v1.0.0', 'v1.1.0'], 'serialized publication version numbers')
  equal(versions.map(item => item.snapshot.version), ['v1.0.0', 'v1.1.0'], 'snapshots reflect each publication state')
  equal((await pool.query('SELECT count(*)::int AS n FROM rubric_versions WHERE rubric_id=$1', [created.id])).rows[0].n, 2, 'two persisted versions')
  equal((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE target_id=$1 AND action='evaluation.rubric.publish'", [created.id])).rows[0].n, 2, 'two success audits')
  await verifyProviderRace(created.id, providerId)
}

function observeQueries(query) {
  return { async connect() {
    const client = await pool.connect()
    return { query: (statement, values) => query(client, statement, values), release: () => client.release() }
  } }
}

function bounded(promise, label) {
  let timer
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), 5000) })])
    .finally(() => clearTimeout(timer))
}

async function assertBlocked(blocker, blocked, label) {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    if ((await admin.query('SELECT pg_blocking_pids($1) AS pids', [blocked])).rows[0].pids.includes(blocker)) {
      equal(true, true, label)
      return
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(label)
}

async function verifyProviderRace(rubricId, providerId) {
  let unlock, ready, publisher
  const released = new Promise(resolve => { unlock = resolve })
  const locked = new Promise(resolve => { ready = resolve })
  const racing = createRubricsHandler(createPostgresRubricsBackend(observeQueries(async (client, statement, values) => {
    if (statement.startsWith('INSERT INTO rubric_versions')) {
      publisher = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
      ready()
      await released
    }
    return client.query(statement, values)
  })))
  const writer = await pool.connect()
  const writerPid = (await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
  const pending = []
  try {
    pending.push(request(`${base}/${rubricId}/publish`, 'POST', undefined, csrf, racing))
    await bounded(locked, 'publication reached snapshot insertion')
    pending.push(writer.query("UPDATE model_providers SET status='disabled' WHERE id=$1", [providerId]))
    await assertBlocked(publisher, writerPid, 'Provider stop actually blocked until publication commit')
  } finally {
    unlock()
    await Promise.allSettled(pending)
    writer.release()
  }
  equal((await pending[0]).status, 201, 'publication before Provider stop succeeds')
  equal((await pending[1]).rowCount, 1, 'Provider stop completes after publication')
  equal((await request(`${base}/${rubricId}/publish`, 'POST')).status, 422, 'later publication rejects stopped Provider')
  equal((await pool.query('SELECT count(*)::int AS n FROM rubric_versions WHERE rubric_id=$1', [rubricId])).rows[0].n, 3, 'rejected later publication leaves no extra version')
  console.log('Observed real rubric publication and Provider deactivation blocking')
}

function normalizeResponses(value) {
  const ids = new Map()
  const id = raw => { if (!ids.has(raw)) ids.set(raw, `id-${ids.size}`); return ids.get(raw) }
  const visit = (item, dimension = false) => {
    if (Array.isArray(item)) return item.map(value => visit(value, dimension))
    if (!item || typeof item !== 'object') return item
    return Object.fromEntries(Object.entries(item).map(([key, value]) => [key,
      key === 'createdAt' ? '<timestamp>' : (key === 'id' && !dimension) || key === 'modelProviderId' ? id(value)
        : visit(value, key === 'dimensions')]))
  }
  return visit(value)
}

async function verifySeedRace(otherCookie) {
  const now = new Date()
  await pool.query(`INSERT INTO workspaces (id,organization_id,name,slug,status,created_at,updated_at)
    VALUES ('race','org','race','race','active',$1,$1)`, [now])
  await pool.query(`INSERT INTO workspace_memberships (id,workspace_id,user_id,role,status,created_at,updated_at)
    VALUES ('race','race','actor','viewer','active',$1,$1)`, [now])
  let unlock, ready, attempt
  const released = new Promise(resolve => { unlock = resolve })
  const locked = new Promise(resolve => { ready = resolve })
  const attempted = new Promise(resolve => { attempt = resolve })
  const pids = []
  const racing = createRubricsHandler(createPostgresRubricsBackend({
    async connect() {
      const client = await pool.connect()
      return {
        async query(statement, values) {
          if (statement === 'SELECT id FROM workspaces WHERE id=$1 FOR UPDATE' && values[0] === 'race') {
            const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
            const first = pids.length === 0
            pids.push(pid)
            if (!first) attempt()
            const result = await client.query(statement, values)
            if (first) { ready(); await released }
            return result
          }
          return client.query(statement, values)
        },
        release() { client.release() },
      }
    },
  }))
  const timeout = (promise, label) => {
    let timer
    return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), 5000) })])
      .finally(() => clearTimeout(timer))
  }
  const pending = []
  try {
    pending.push(request('/api/workspaces/race/evaluations/rubrics', 'GET', undefined, csrf, racing))
    await timeout(locked, 'first seed lock not acquired')
    pending.push(racing(new Request('https://synthetic.invalid/api/workspaces/race/evaluations/rubrics', {
      headers: { Cookie: otherCookie },
    })))
    await timeout(attempted, 'second seed lock not attempted')
    const deadline = Date.now() + 3000
    let blocked = false
    while (Date.now() < deadline) {
      const row = (await admin.query('SELECT pg_blocking_pids($1) AS pids', [pids[1]])).rows[0]
      if (row.pids.includes(pids[0])) { blocked = true; break }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    equal(blocked, true, 'second initialization actually blocked on first workspace lock')
  } finally {
    unlock()
    await Promise.allSettled(pending)
  }
  const responses = await Promise.all(pending)
  equal(responses.map(response => response.status), [200, 200], 'both default requests succeed')
  equal(await responses[0].json(), await responses[1].json(), 'same persisted default IDs after lock recheck')
  equal((await pool.query("SELECT count(*)::int AS n FROM rubrics WHERE workspace_id='race'")).rows[0].n, 3, 'race creates exactly three rows')
  console.log('Observed actual PostgreSQL default-initialization blocking and post-lock recheck')
}
