// Fixed loopback database and independently checked random-schema cleanup; no credentials.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { createIdentityWorkspaceHandler } from '../netlify/functions/_shared/identity-workspace/handler.ts'
import { createPostgresIdentityWorkspaceBackend } from '../netlify/functions/_shared/identity-workspace/postgres.ts'
import { hashPassword } from '../netlify/functions/_shared/identity-workspace/security.ts'
import { createDataObjectsHandler } from '../netlify/functions/_shared/data-objects/handler.ts'
import { createPostgresDataObjectsBackend } from '../netlify/functions/_shared/data-objects/postgres.ts'

const { Pool } = createRequire(import.meta.resolve('@netlify/database'))('pg')
const port = process.argv[2] ?? '5432'
if (!/^[0-9]{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid local test port')
const connectionString = `postgresql://postgres@127.0.0.1:${port}/arc_identity_test`
const schema = `data_objects_test_${randomUUID().replaceAll('-', '')}`
const admin = new Pool({ connectionString, connectionTimeoutMillis: 5000 })
const pool = new Pool({ connectionString, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000,
  statement_timeout: 10000, max: 4 })
let checks = 0
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++ }
const identity = createIdentityWorkspaceHandler(createPostgresIdentityWorkspaceBackend(pool))
const handler = createDataObjectsHandler(createPostgresDataObjectsBackend(pool))
let cookie = '', csrf = ''
const base = '/api/workspaces/a/data-objects'
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
  const data = { name: 'Synthetic Object', schema: { properties: { first: { type: 'string' } } } }
  equal((await request(base, 'POST', data, '')).status, 403, 'CSRF required')
  const created = await request(base, 'POST', data)
  equal(created.status, 201, 'create')
  const definition = await created.json()
  equal([definition.status, definition.version, definition.description], ['draft', 'unpublished', ''], 'defaults')
  equal(await (await request(base)).json(), [definition], 'persisted list')
  const path = `${base}/${definition.id}`
  equal(await (await request(`${path}/versions`)).json(), [], 'empty history')
  equal((await request(`/api/workspaces/b/data-objects/${definition.id}/versions`)).status, 404, 'cross-space history')
  equal((await request(`${base}/missing/versions`)).status, 404, 'missing definition')
  const firstResponse = await request(`${path}/publish`, 'POST')
  equal(firstResponse.status, 201, 'publish')
  const first = await firstResponse.json()
  equal(first.snapshot, definition, 'snapshot predates state update')
  const changed = { properties: { score: { type: 'number' } } }
  equal((await request(path, 'PATCH', { schema: changed, name: null })).status, 200, 'edit and skip null')
  const secondResponse = await request(`${path}/publish`, 'POST')
  equal(secondResponse.status, 201, 'republish')
  const second = await secondResponse.json()
  equal(second.version, 'v1.1.0', 'version counter')
  equal(second.snapshot.schema, changed, 'new schema frozen')
  equal(await (await request(`${path}/versions`)).json(), [second, first], 'history newest first')
  equal((await admin.query(`SELECT snapshot FROM ${schema}.data_object_versions WHERE id=$1`, [first.id])).rows[0].snapshot,
    first.snapshot, 'independent original remains frozen')
  equal((await request(base, 'POST', data)).status, 409, 'duplicate name conflict')
  await pool.query(`ALTER TABLE audit_events ADD CONSTRAINT synthetic_audit_failure CHECK (action <> 'data_object_definition.publish') NOT VALID`)
  equal((await request(`${path}/publish`, 'POST')).status, 503, 'audit failure rejects publication')
  equal(await (await request(`${path}/versions`)).json(), [second, first], 'no partial version')
  equal((await admin.query(`SELECT version FROM ${schema}.data_object_definitions WHERE id=$1`, [definition.id])).rows[0].version,
    'v1.1.0', 'no false definition state')
  await pool.query('ALTER TABLE audit_events DROP CONSTRAINT synthetic_audit_failure')
  // Different sessions avoid serializing the race on the same authentication session row.
  const secondLogin = await request('/api/auth/login', 'POST', { email: 'actor@example.invalid', password }, '', identity)
  equal(secondLogin.status, 200, 'second independent session')
  const secondCookie = secondLogin.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  const secondCsrf = decodeURIComponent(secondCookie.match(/arc_one_csrf=([^;]+)/)[1])
  const otherSession = (path, body) => handler(new Request(`https://synthetic.invalid${path}`, { method: 'POST',
    headers: { Cookie: secondCookie, 'X-CSRF-Token': secondCsrf },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
  const concurrent = await Promise.all([request(`${path}/publish`, 'POST'), otherSession(`${path}/publish`)])
  equal(concurrent.map(response => response.status), [201, 201], 'concurrent publish succeeds')
  equal((await Promise.all(concurrent.map(response => response.json()))).map(version => version.version).sort(),
    ['v1.2.0', 'v1.3.0'], 'separate immutable versions')
  const duplicateRace = await Promise.all([request(base, 'POST', { ...data, name: 'Race name' }),
    otherSession(base, { ...data, name: 'Race name' })])
  equal(duplicateRace.map(response => response.status).sort(), [201, 409], 'unique name race controlled')
  equal((await admin.query(`SELECT count(*)::int AS n FROM ${schema}.data_object_definitions WHERE name='Race name'`)).rows[0].n,
    1, 'one winning definition')
  let roleRouteChecks = 0
  for (const role of ['viewer', 'operator', 'builder', 'workspace_admin']) {
    await pool.query('UPDATE workspace_memberships SET role=$1 WHERE id=$2', [role, 'a'])
    const canWrite = ['builder', 'workspace_admin'].includes(role)
    const before = (await admin.query(`SELECT name,version FROM ${schema}.data_object_definitions WHERE id=$1`, [definition.id])).rows[0]
    for (const [method, suffix, body] of [['GET', ''], ['POST', '', { ...data, name: `Role ${role}` }],
      ['PATCH', `/${definition.id}`, { name: `Edited ${role}` }], ['POST', `/${definition.id}/publish`],
      ['GET', `/${definition.id}/versions`]]) {
      const response = await request(base + suffix, method, body)
      equal(response.status, method === 'GET' ? 200 : !canWrite ? 403 : method === 'POST' ? 201 : 200, `${role} ${method} ${suffix}`)
      roleRouteChecks++
    }
    if (!canWrite) equal((await admin.query(`SELECT name,version FROM ${schema}.data_object_definitions WHERE id=$1`, [definition.id])).rows[0],
      before, `${role} denied writes preserve definition`)
  }
  await pool.query(`UPDATE workspace_memberships SET role='builder' WHERE id='a'`)
  const currentVersions = await (await request(`${path}/versions`)).json()
  const candidate = `v1.${currentVersions.length}.0`
  await pool.query('UPDATE data_object_versions SET version=$1 WHERE id=$2', [candidate, first.id])
  equal((await request(`${path}/publish`, 'POST')).status, 409, 'existing candidate cannot be overwritten')
  equal((await admin.query(`SELECT count(*)::int AS n FROM ${schema}.data_object_versions WHERE definition_id=$1`, [definition.id])).rows[0].n,
    currentVersions.length, 'version conflict leaves no partial version')
  await pool.query('UPDATE data_object_versions SET version=$1 WHERE id=$2', [first.version, first.id])
  for (const [operation, target, method, body] of [
    ['create', base, 'POST', { ...data, name: 'Audit rollback create' }],
    ['update', path, 'PATCH', { name: 'Audit rollback update' }],
  ]) {
    const before = (await admin.query(`SELECT name,updated_at FROM ${schema}.data_object_definitions WHERE id=$1`, [definition.id])).rows[0]
    await pool.query(`ALTER TABLE audit_events ADD CONSTRAINT synthetic_audit_failure CHECK (action <> 'data_object_definition.${operation}') NOT VALID`)
    equal((await request(target, method, body)).status, 503, `${operation} audit failure`)
    equal((await admin.query(`SELECT count(*)::int AS n FROM ${schema}.data_object_definitions WHERE name=$1`, [body.name])).rows[0].n,
      0, `${operation} leaves no changed name`)
    equal((await admin.query(`SELECT name,updated_at FROM ${schema}.data_object_definitions WHERE id=$1`, [definition.id])).rows[0],
      before, `${operation} rollback preserves original timestamp`)
    await pool.query('ALTER TABLE audit_events DROP CONSTRAINT synthetic_audit_failure')
  }
  await pool.query(`UPDATE workspace_memberships SET status='disabled' WHERE id='a'`)
  equal((await request(`${path}/versions`)).status, 404, 'revoked membership hides workspace history')
  equal((await request(path, 'PATCH', { name: 'Denied' })).status, 404, 'revoked membership hides workspace write target')
  await pool.query(`UPDATE workspace_memberships SET status='active' WHERE id='a'`)
  await pool.query(`UPDATE data_object_versions SET snapshot=$1 WHERE id=$2`, [JSON.stringify({ schema: [] }), first.id])
  const invalid = await request(`${path}/versions`)
  equal(invalid.status, 409, 'invalid history rejected')
  equal(await invalid.json(), { detail: '历史 Data Object 版本结构不符合要求，需先完成治理' }, 'fixed history error')
  equal((await admin.query(`SELECT snapshot FROM ${schema}.data_object_versions WHERE id=$1`, [first.id])).rows[0].snapshot,
    { schema: [] }, 'invalid history not rewritten')
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/data-object-requests.json', import.meta.url), 'utf8'))
  const python = spawnSync(process.argv[3] ?? 'python', ['scripts/data-object-contract-python.py'], {
    input: JSON.stringify(fixture), encoding: 'utf8', timeout: 60000,
  })
  assert.equal(python.status, 0, 'synthetic Python HTTP replay must complete')
  const expected = JSON.parse(python.stdout)
  // Separate synthetic workspace keeps list responses independent of earlier fault fixtures.
  await pool.query(`INSERT INTO workspaces (id,organization_id,name,slug,status,created_at,updated_at)
    VALUES ('contract','org','Contract','contract','active',$1,$1)`, [now])
  await pool.query(`INSERT INTO workspace_memberships (id,workspace_id,user_id,role,status,created_at,updated_at)
    VALUES ('contract','contract','actor','builder','active',$1,$1)`, [now])
  const contractBase = '/api/workspaces/contract/data-objects'
  const contractHandler = createDataObjectsHandler(createPostgresDataObjectsBackend(pool), { clientAddress: '192.0.2.30' })
  const actual = []
  for (const testCase of fixture.cases) {
    const response = await request(contractBase, 'POST', testCase.body, csrf, contractHandler)
    const result = { name: testCase.name, status: response.status, body: await response.json() }
    if (testCase.followUps) {
      result.followUps = []
      for (const step of testCase.followUps) {
        const follow = await request(step.root ? contractBase : `${contractBase}/${result.body.id}${step.suffix}`,
          step.method, step.body, csrf, contractHandler)
        result.followUps.push({ status: follow.status, body: await follow.json() })
      }
    }
    actual.push(result)
  }
  equal(normalizeResponses(actual), normalizeResponses(expected), 'shared actual HTTP response contracts')
  console.log(JSON.stringify({ passed: true, checks, roleRouteChecks, sharedRequests: fixture.cases.length,
    sharedFollowUps: fixture.cases.reduce((sum, item) => sum + (item.followUps?.length ?? 0), 0) }))
} finally {
  await pool.end()
  try {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    assert.equal((await admin.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [schema])).rowCount, 0)
    console.log('Synthetic schema cleanup independently confirmed')
  } finally { await admin.end() }
}

function normalizeResponses(results) {
  const identifiers = new Map()
  const id = value => {
    if (!identifiers.has(value)) identifiers.set(value, `id-${identifiers.size}`)
    return identifiers.get(value)
  }
  const body = value => {
    if (Array.isArray(value)) return value.map(body)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      ['id', 'definitionId', 'createdBy'].includes(key) ? id(item)
        : ['createdAt', 'updatedAt'].includes(key) ? '<timestamp>'
          : key === 'snapshot' ? body(item) : item]))
  }
  const response = value => ({ ...value, body: body(value.body),
    ...(value.followUps ? { followUps: value.followUps.map(response) } : {}) })
  return results.map(response)
}
