import test from 'node:test'
import assert from 'node:assert/strict'
import { runtimeTestDatabase } from './runtime-test-db.mjs'
import { hashPassword } from '../netlify/functions/_shared/identity-workspace/security.ts'
import { createIdentityWorkspaceHandler } from '../netlify/functions/_shared/identity-workspace/handler.ts'
import { createPostgresIdentityWorkspaceBackend } from '../netlify/functions/_shared/identity-workspace/postgres.ts'
export async function seedRuntimeIdentity(pool) {
  await pool.query("INSERT INTO organizations VALUES('org','Synthetic','synthetic','active',now(),now())")
  for (const id of ['a','b']) await pool.query("INSERT INTO workspaces(id,organization_id,name,slug,status,created_at,updated_at) VALUES($1,'org',$1,$1,'active',now(),now())", [id])
  await pool.query(`INSERT INTO users(id,organization_id,email,normalized_email,display_name,password_hash,status,is_organization_admin,failed_login_count,created_at,updated_at)
    VALUES('actor','org','actor@example.invalid','actor@example.invalid','Synthetic',$1,'active',false,0,now(),now())`, [await hashPassword('Synthetic-only-test-123!')])
  await pool.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,role,status,created_at,updated_at) VALUES('member','a','actor','workspace_admin','active',now(),now())")
  const login = await createIdentityWorkspaceHandler(createPostgresIdentityWorkspaceBackend(pool))(new Request('https://synthetic.invalid/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'actor@example.invalid', password: 'Synthetic-only-test-123!' }) }))
  assert.equal(login.status, 200)
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  return { cookie, csrf: decodeURIComponent(cookie.match(/arc_one_csrf=([^;]+)/)[1]) }
}
test('native operation HTTP enforces session, CSRF, workspace, capability and durable202', async () => {
  const { createRuntimeHandler } = await import('../netlify/functions/_shared/runtime/handler.ts')
  const { createPostgresRuntimeBackend } = await import('../netlify/functions/_shared/runtime/postgres.ts')
  const { enqueueOperation, runtimeWithTransaction } = await import('../netlify/functions/_shared/runtime/ledger.ts')
  const db = await runtimeTestDatabase()
  try {
    const { cookie, csrf } = await seedRuntimeIdentity(db.pool)
    const handler = createRuntimeHandler(createPostgresRuntimeBackend(db.pool))
    const op = await runtimeWithTransaction(db.pool, c => enqueueOperation(c, { workspaceId: 'a', kind: 'test', input: {}, idempotencyKey: 'a' }))
    const path = `/api/workspaces/a/operations/${op.id}`
    const request = (p=path, method='GET', body, headers={}) => handler(new Request(`https://synthetic.invalid${p}`, { method,
      headers: { Cookie: cookie, 'X-CSRF-Token': csrf, ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }))
    assert.equal((await request(path,'GET',undefined,{Cookie:''})).status,401)
    assert.equal((await request(path.replace('/a/','/b/'))).status,404)
    assert.equal((await request(`${path}/cancel`,'POST',{reason:'synthetic'},{'X-CSRF-Token':''})).status,403)
    assert.equal((await request(`${path}/cancel`,'POST',{reason:'synthetic'},{Origin:'https://evil.invalid'})).status,403)
    await db.pool.query("UPDATE workspace_memberships SET role='viewer' WHERE id='member'")
    assert.equal((await request(`${path}/cancel`,'POST',{reason:'synthetic'})).status,403)
    await db.pool.query("UPDATE workspace_memberships SET role='operator' WHERE id='member'")
    assert.equal((await request(`${path}/cancel`,'POST',{reason:'synthetic'})).status,200)
    const result = await (await request()).json()
    assert.equal(result.status,'canceled'); assert.equal(result.input,undefined)
  } finally { await db.close() }
})
