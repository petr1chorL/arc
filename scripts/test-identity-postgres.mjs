// Explicit, disposable loopback database only. Never reads .env or production credentials.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { createIdentityWorkspaceHandler } from '../netlify/functions/_shared/identity-workspace/handler.ts'
import { createPostgresIdentityWorkspaceBackend } from '../netlify/functions/_shared/identity-workspace/postgres.ts'
import { digestToken, hashPassword } from '../netlify/functions/_shared/identity-workspace/security.ts'

// Reuse the driver declared by the installed Database SDK, not an undeclared hoisted package.
const { Pool } = createRequire(import.meta.resolve('@netlify/database'))('pg')
// Keep host/database fixed to the disposable local fixture; only the host port may vary.
const port = process.argv[3] ?? '5432'
if (!/^[0-9]{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  throw new Error('Local PostgreSQL test port must be an integer between 1 and 65535')
}
const database = `postgresql://postgres@127.0.0.1:${port}/arc_identity_test`
const schema = `identity_test_${randomUUID().replaceAll('-', '')}`
const adminPool = new Pool({ connectionString: database, connectionTimeoutMillis: 5000 })
const pool = new Pool({ connectionString: database, options: `-c search_path=${schema}`,
  connectionTimeoutMillis: 5000, statement_timeout: 10_000, max: 8 })
const query = (sql, values) => pool.query(sql, values)
let checks = 0
function equal(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++ }

try {
  await adminPool.query(`CREATE SCHEMA ${schema}`)
  for (const migration of ['20260904060000_create-arc-one-baseline', '20260904133000_create-identity-rate-limits']) {
    await query(readFileSync(new URL(`../netlify/database/migrations/${migration}/migration.sql`, import.meta.url), 'utf8'))
  }
  const now = new Date()
  await query(`INSERT INTO organizations VALUES ('org','Synthetic','synthetic','active',$1,$1)`, [now])
  for (const id of ['a', 'b']) await query(
    `INSERT INTO workspaces (id,organization_id,name,slug,status,created_at,updated_at)
     VALUES ($1,'org',$1,$1,'active',$2,$2)`, [id, now])
  const password = `Synthetic-${randomUUID()}!`
  const hash = await hashPassword(password)
  for (const [id, isAdmin] of [['actor', true], ['target', false], ['backup', false]]) {
    await query(`INSERT INTO users
      (id,organization_id,email,normalized_email,display_name,password_hash,status,is_organization_admin,
       failed_login_count,created_at,updated_at)
      VALUES ($1,'org',$2,$2,$1,$3,'active',$4,0,$5,$5)`, [id, `${id}@example.invalid`, hash, isAdmin, now])
  }
  for (const [id, workspace, user, role] of [
    ['aa','a','actor','workspace_admin'], ['ta','a','target','builder'],
    ['ba','a','backup','workspace_admin'], ['tb','b','target','workspace_admin'],
  ]) await query(`INSERT INTO workspace_memberships
    (id,workspace_id,user_id,role,status,created_at,updated_at) VALUES ($1,$2,$3,$4,'active',$5,$5)`,
  [id, workspace, user, role, now])

  const backend = createPostgresIdentityWorkspaceBackend(pool)
  const handler = createIdentityWorkspaceHandler(backend, { clientAddress: '192.0.2.1' })
  let cookie = '', csrf = ''
  async function request(path, method = 'GET', body, withCsrf = true, selectedHandler = handler) {
    return selectedHandler(new Request(`https://synthetic.invalid${path}`, {
      method, headers: { Cookie: cookie, ...(withCsrf ? { 'X-CSRF-Token': csrf } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }))
  }
  const legacy = { unauthenticated: (await request('/api/auth/session')).status }
  const login = await request('/api/auth/login', 'POST', { email: 'actor@example.invalid', password })
  equal(login.status, 200, 'real PG login')
  cookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ')
  csrf = decodeURIComponent(cookie.match(/arc_one_csrf=([^;]+)/)[1])
  legacy.sessionKeys = Object.keys((await (await request('/api/auth/session')).json()).user).sort()
  legacy.workspaceKeys = Object.keys(await (await request('/api/workspaces/a')).json()).sort()
  legacy.memberKeys = Object.keys((await (await request('/api/workspaces/a/members')).json())[0]).sort()
  const disable = '/api/workspaces/a/members/target/user/disable'
  legacy.missingCsrf = (await request(disable, 'POST', undefined, false)).status
  const blocked = await request(disable, 'POST')
  legacy.globalDisable = { status: blocked.status, body: await blocked.json() }
  legacy.targetStatus = (await query(`SELECT status FROM users WHERE id='target'`)).rows[0].status
  equal(legacy.globalDisable.status, 409, 'global last admin protected')
  equal((await query(`SELECT count(*)::int AS n FROM audit_events WHERE action='user.disable'`)).rows[0].n, 0,
    'rejected operation has no success audit')
  const python = spawnSync(process.argv[2] ?? 'python', ['scripts/identity-contract-python.py'], {
    encoding: 'utf8', timeout: 90_000,
  })
  assert.equal(python.status, 0, `Legacy contract replay failed: ${python.stderr}`)
  equal(legacy, JSON.parse(python.stdout), 'Python/TypeScript status and response-field contract')

  await query(`INSERT INTO workspace_memberships
    (id,workspace_id,user_id,role,status,created_at,updated_at)
    VALUES ('bb','b','backup','workspace_admin','active',$1,$1)`, [now])
  // Two independent actor sessions ensure PostgreSQL, not the session lock, serializes writes.
  const parallelLogin = await request('/api/auth/login', 'POST', { email: 'actor@example.invalid', password })
  const secondCookie = parallelLogin.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ')
  const secondCsrf = decodeURIComponent(secondCookie.match(/arc_one_csrf=([^;]+)/)[1])
  const concurrent = await Promise.all([
    request(disable, 'POST'),
    handler(new Request('https://synthetic.invalid/api/workspaces/b/members/backup', {
      method: 'PATCH', headers: { Cookie: secondCookie, 'X-CSRF-Token': secondCsrf },
      body: JSON.stringify({ role: 'builder' }),
    })),
  ])
  equal(concurrent.map((response) => response.status).sort(), [200, 409], 'concurrent global disable vs demotion')
  equal((await query(`SELECT count(*)::int AS n FROM workspace_memberships m JOIN users u ON u.id=m.user_id
    WHERE m.workspace_id='b' AND m.role='workspace_admin' AND m.status='active'
    AND u.status='active' AND NOT u.is_organization_admin`)).rows[0].n, 1, 'exactly one effective admin remains')

  const throttledHandler = createIdentityWorkspaceHandler(backend, { clientAddress: '192.0.2.2' })
  for (let index = 0; index < 120; index++) equal(
    (await request('/api/auth/login', 'POST', {}, true, throttledHandler)).status, 422, 'invalid calls consume budget')
  const limited = await request('/api/auth/login', 'POST', {}, true, throttledHandler)
  equal(limited.status, 429, 'budget persists across rolled-back validation failures')
  equal(limited.headers.get('Retry-After'), '60', 'retry contract')
  await query(`UPDATE identity_rate_limits SET window_started_at=clock_timestamp()-INTERVAL '61 seconds'
    WHERE bucket_key=$1`, [`request:client:${await digestToken('192.0.2.2')}`])
  equal((await request('/api/auth/login', 'POST', {}, true, throttledHandler)).status, 422, 'window resets')
  console.log(JSON.stringify({ postgresIdentityChecks: checks, legacyContract: 'matched', concurrentAdminRemoval: 'protected' }))
} finally {
  await pool.end()
  // Only the unique schema created above in this hard-coded disposable database is removed.
  await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
  await adminPool.end()
}
